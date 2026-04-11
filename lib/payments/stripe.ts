import Stripe from 'stripe';
import { PLAN_CONFIG, type PlanType } from '@/lib/db/schema';

// Initialize Stripe
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
  typescript: true,
});

// Map plan types to Stripe price IDs
export function getStripePriceId(plan: PlanType): string | null {
  const priceIds: Record<PlanType, string | null> = {
    free: null,
    plus: process.env.STRIPE_PLUS_PRICE_ID || null,
    pro: process.env.STRIPE_PRO_PRICE_ID || null,
    premium: process.env.STRIPE_PREMIUM_PRICE_ID || null,
  };
  return priceIds[plan];
}

// Map token amounts to Stripe price IDs for extra tokens purchase
export function getTokenPriceId(tokens: number): string | null {
  const priceIds: Record<number, string | null> = {
    100_000: process.env.STRIPE_100ktokens_PRICE_ID || null,
    500_000: process.env.STRIPE_500ktokens_PRICE_ID || null,
    1_000_000: process.env.STRIPE_1mtokens_PRICE_ID || null,
    2_000_000: process.env.STRIPE_2mtokens_PRICE_ID || null,
  };
  return priceIds[tokens] || null;
}

// Get plan from Stripe price ID
export function getPlanFromPriceId(priceId: string): PlanType | null {
  if (priceId === process.env.STRIPE_PLUS_PRICE_ID) return 'plus';
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return 'pro';
  if (priceId === process.env.STRIPE_PREMIUM_PRICE_ID) return 'premium';
  return null;
}

/**
 * Create a Stripe customer
 */
export async function createStripeCustomer(email: string, name?: string): Promise<string> {
  const customer = await stripe.customers.create({
    email,
    name: name || undefined,
    metadata: {
      source: 'ai-teaching-assistant',
    },
  });
  return customer.id;
}

/**
 * Create a checkout session for subscription
 */
export async function createCheckoutSession({
  userId,
  email,
  plan,
  customerId,
  successUrl,
  cancelUrl,
}: {
  userId: string;
  email: string;
  plan: PlanType;
  customerId?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const priceId = getStripePriceId(plan);
  
  if (!priceId) {
    throw new Error(`No Stripe price configured for plan: ${plan}`);
  }
  
  const sessionConfig: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      userId,
      plan,
    },
    subscription_data: {
      metadata: {
        userId,
        plan,
      },
    },
  };
  
  // Use existing customer or create by email
  if (customerId) {
    sessionConfig.customer = customerId;
  } else {
    sessionConfig.customer_email = email;
  }
  
  const session = await stripe.checkout.sessions.create(sessionConfig);
  return session.url!;
}

/**
 * Create a billing portal session
 */
export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

/**
 * Cancel a subscription
 */
export async function cancelStripeSubscription(
  subscriptionId: string,
  atPeriodEnd: boolean = true
): Promise<Stripe.Subscription> {
  if (atPeriodEnd) {
    return stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  } else {
    return stripe.subscriptions.cancel(subscriptionId);
  }
}

/**
 * Cancel all other subscriptions for a customer (keep only the specified one or none)
 * This prevents duplicate subscriptions
 */
export async function cancelAllOtherSubscriptions(
  customerId: string,
  keepSubscriptionId?: string
): Promise<number> {
  try {
    // Get all active subscriptions for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
    });
    
    let cancelledCount = 0;
    
    for (const subscription of subscriptions.data) {
      // Skip the subscription we want to keep
      if (keepSubscriptionId && subscription.id === keepSubscriptionId) {
        continue;
      }
      
      // Cancel immediately (not at period end) to clean up duplicates
      await stripe.subscriptions.cancel(subscription.id);
      cancelledCount++;
      console.log(`[Stripe] Cancelled duplicate subscription: ${subscription.id}`);
    }
    
    return cancelledCount;
  } catch (error) {
    console.error('[Stripe] Error cancelling other subscriptions:', error);
    return 0;
  }
}

/**
 * Resume a cancelled subscription
 */
export async function resumeStripeSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
}

/**
 * Update subscription to a new plan
 * For downgrades, change takes effect at end of current period
 * For upgrades, change takes effect immediately with proration
 */
export async function updateSubscriptionPlan(
  subscriptionId: string,
  newPlan: PlanType,
  isDowngrade: boolean = false
): Promise<Stripe.Subscription> {
  const priceId = getStripePriceId(newPlan);
  
  if (!priceId) {
    throw new Error(`No Stripe price configured for plan: ${newPlan}`);
  }
  
  // Get current subscription
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  
  // Both upgrade and downgrade: immediate change with proration
  // This ensures maximum 2 months of subscription (current + next month)
  // Proration handles the credit/charge automatically
  return stripe.subscriptions.update(subscriptionId, {
    items: [
      {
        id: subscription.items.data[0].id,
        price: priceId,
      },
    ],
    proration_behavior: 'create_prorations', // Immediate change with proration
    metadata: {
      plan: newPlan,
    },
  });
}

/**
 * Get subscription details
 */
export async function getStripeSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId);
}

/**
 * Create a one-time payment checkout session for token purchase
 */
export async function createTokenPurchaseSession({
  userId,
  email,
  tokens,
  amountUSD,
  customerId,
  successUrl,
  cancelUrl,
}: {
  userId: string;
  email: string;
  tokens: number;
  amountUSD: number;
  customerId?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  // Try to use predefined price ID first, fallback to dynamic price creation
  const priceId = getTokenPriceId(tokens);
  
  const sessionConfig: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment', // One-time payment, not subscription
    payment_method_types: ['card'],
    line_items: priceId
      ? [
          // Use predefined price ID if available
          {
            price: priceId,
            quantity: 1,
          },
        ]
      : [
          // Fallback to dynamic price creation if price ID not found
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `${(tokens / 1000).toLocaleString()}K Tokens`,
                description: `One-time purchase of ${(tokens / 1000).toLocaleString()}K tokens`,
              },
              unit_amount: Math.round(amountUSD * 100), // Convert to cents
            },
            quantity: 1,
          },
        ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      userId,
      tokens: tokens.toString(),
      type: 'token_purchase',
    },
  };
  
  // Use existing customer or create by email
  if (customerId) {
    sessionConfig.customer = customerId;
  } else {
    sessionConfig.customer_email = email;
  }
  
  const session = await stripe.checkout.sessions.create(sessionConfig);
  return session.url!;
}

/**
 * Construct and verify a webhook event
 */
export function constructWebhookEvent(
  payload: Buffer,
  signature: string
): Stripe.Event {
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
}
