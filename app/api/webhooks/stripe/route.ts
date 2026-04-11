import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import prisma from '@/lib/db/client';
import { constructWebhookEvent, getPlanFromPriceId, cancelAllOtherSubscriptions } from '@/lib/payments/stripe';
import { PLAN_CONFIG } from '@/lib/db/schema';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get('stripe-signature');
  
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }
  
  let event: Stripe.Event;
  
  try {
    event = constructWebhookEvent(Buffer.from(body), signature);
  } catch (err: any) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
  
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutComplete(session);
        break;
      }
      
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaid(invoice);
        break;
      }
      
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }
      
      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
    
    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Stripe webhook handler error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const purchaseType = session.metadata?.type;
  
  if (!userId) {
    console.error('Missing userId in checkout session metadata');
    return;
  }
  
  // Handle token purchase (one-time payment)
  if (purchaseType === 'token_purchase') {
    const tokens = parseInt(session.metadata?.tokens || '0', 10);
    
    if (tokens <= 0) {
      console.error('Invalid tokens amount in token purchase');
      return;
    }
    
    // Add tokens to user's subscription
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
    });
    
    if (subscription) {
      // Increment both tokensLimit and extraTokensPurchased
      // extraTokensPurchased persists across plan changes
      await prisma.subscription.update({
        where: { userId },
        data: {
          tokensLimit: {
            increment: BigInt(tokens),
          },
          extraTokensPurchased: {
            increment: BigInt(tokens),
          },
          // Also update stripe customer ID if not set
          ...(session.customer && !subscription.stripeCustomerId
            ? { stripeCustomerId: session.customer as string }
            : {}),
        },
      });
    } else {
      // Create subscription if it doesn't exist (shouldn't happen, but handle it)
      await prisma.subscription.create({
        data: {
          userId,
          plan: 'free',
          tokensLimit: BigInt(PLAN_CONFIG.free.tokensLimit + tokens),
          extraTokensPurchased: BigInt(tokens),
          exportsLimit: PLAN_CONFIG.free.exportLimit, // 2 exports for free plan
        },
      });
    }
    
    // Create payment record
    if (session.amount_total) {
      await prisma.paymentRecord.create({
        data: {
          userId,
          provider: 'stripe',
          providerPaymentId: session.payment_intent as string || session.id,
          amount: session.amount_total / 100,
          currency: session.currency?.toUpperCase() || 'USD',
          status: 'succeeded',
          metadata: {
            type: 'token_purchase',
            tokens: tokens.toString(),
            sessionId: session.id,
          },
        },
      });
    }
    
    console.log(`Token purchase completed for user ${userId}: +${tokens} tokens`);
    return;
  }
  
  // Handle subscription purchase
  const plan = session.metadata?.plan as keyof typeof PLAN_CONFIG;
  
  if (!plan) {
    console.error('Missing plan in checkout session metadata');
    return;
  }
  
  const planConfig = PLAN_CONFIG[plan];
  
  // Cancel any other subscriptions for this customer to prevent duplicates
  const customerId = session.customer as string;
  const newSubscriptionId = session.subscription as string;
  
  if (customerId && newSubscriptionId) {
    const cancelledCount = await cancelAllOtherSubscriptions(customerId, newSubscriptionId);
    if (cancelledCount > 0) {
      console.log(`[Webhook] Cancelled ${cancelledCount} duplicate subscription(s) for customer ${customerId}`);
    }
  }
  
  // When trial user upgrades to paid plan, clear trial flags
  const paidPlans = ['premium', 'plus', 'pro'];
  const isPaidUpgrade = paidPlans.includes(plan);

  await prisma.subscription.upsert({
    where: { userId },
    update: {
      plan,
      status: 'active',
      stripeCustomerId: customerId,
      stripeSubscriptionId: newSubscriptionId,
      tokensLimit: BigInt(planConfig.tokensLimit),
      exportsLimit: planConfig.exportLimit ?? null,
      tokensUsed: 0, // Reset usage on new subscription
      exportsUsed: 0, // Reset export usage on new subscription
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      ...(isPaidUpgrade && {
        isTrial: false,
        trialEndsAt: null,
        trialPlan: null,
      }),
    },
    create: {
      userId,
      plan,
      status: 'active',
      stripeCustomerId: customerId,
      stripeSubscriptionId: newSubscriptionId,
      tokensLimit: BigInt(planConfig.tokensLimit),
      exportsLimit: planConfig.exportLimit ?? null,
    },
  });
  
  // Create payment record
  if (session.amount_total) {
    await prisma.paymentRecord.create({
      data: {
        userId,
        provider: 'stripe',
        providerPaymentId: session.payment_intent as string || session.id,
        amount: session.amount_total / 100,
        currency: session.currency?.toUpperCase() || 'USD',
        status: 'succeeded',
        metadata: {
          plan,
          sessionId: session.id,
        },
      },
    });
  }
  
  console.log(`Subscription activated for user ${userId}: ${plan}`);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId = invoice.subscription as string;
  
  if (!subscriptionId) return;
  
  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
  });
  
  if (!subscription) {
    console.log(`No subscription found for Stripe subscription: ${subscriptionId}`);
    return;
  }
  
  // Reset token and export usage on renewal
  const planConfig = PLAN_CONFIG[subscription.plan as keyof typeof PLAN_CONFIG];
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'active',
      tokensUsed: 0,
      exportsUsed: 0,
      exportsLimit: planConfig?.exportLimit ?? null,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  
  // Create payment record
  await prisma.paymentRecord.create({
    data: {
      userId: subscription.userId,
      provider: 'stripe',
      providerPaymentId: invoice.payment_intent as string || invoice.id,
      amount: (invoice.amount_paid || 0) / 100,
      currency: invoice.currency.toUpperCase(),
      status: 'succeeded',
      metadata: {
        invoiceId: invoice.id,
        subscriptionId,
      },
    },
  });
  
  console.log(`Invoice paid for subscription ${subscriptionId}`);
}

async function handleSubscriptionUpdated(stripeSubscription: Stripe.Subscription) {
  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubscription.id },
  });
  
  if (!subscription) {
    console.log(`No subscription found for Stripe subscription: ${stripeSubscription.id}`);
    return;
  }
  
  // Get the new plan from the price
  const priceId = stripeSubscription.items.data[0]?.price?.id;
  const newPlan = priceId ? getPlanFromPriceId(priceId) : null;
  
  const updateData: any = {
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
  };
  
  // Map Stripe status to our status
  const statusMap: Record<string, string> = {
    active: 'active',
    past_due: 'past_due',
    canceled: 'cancelled',
    unpaid: 'past_due',
    trialing: 'trialing',
  };
  
  if (stripeSubscription.status in statusMap) {
    updateData.status = statusMap[stripeSubscription.status];
  }
  
  // Update plan if changed - preserve extraTokensPurchased
  if (newPlan && newPlan !== subscription.plan) {
    updateData.plan = newPlan;
    // tokensLimit = plan base tokens + extra purchased tokens (preserved)
    const extraTokens = subscription.extraTokensPurchased || BigInt(0);
    updateData.tokensLimit = BigInt(PLAN_CONFIG[newPlan].tokensLimit) + extraTokens;
  }

  // When trial user upgrades to paid plan, clear trial flags so they no longer appear in Trial Accounts
  const paidPlans = ['premium', 'plus', 'pro'];
  const effectiveStatus = updateData.status ?? subscription.status;
  const effectivePlan = updateData.plan ?? subscription.plan;
  if (subscription.isTrial && effectiveStatus === 'active' && paidPlans.includes(effectivePlan as string)) {
    updateData.isTrial = false;
    updateData.trialEndsAt = null;
    updateData.trialPlan = null;
  }
  
  // Update period dates
  if (stripeSubscription.current_period_start) {
    updateData.currentPeriodStart = new Date(stripeSubscription.current_period_start * 1000);
  }
  if (stripeSubscription.current_period_end) {
    updateData.currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
  }
  
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: updateData,
  });
  
  console.log(`Subscription updated: ${stripeSubscription.id}`);
}

async function handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription) {
  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubscription.id },
  });
  
  if (!subscription) {
    console.log(`No subscription found for Stripe subscription: ${stripeSubscription.id}`);
    return;
  }
  
  // Downgrade to free plan - preserve extraTokensPurchased
  const extraTokens = subscription.extraTokensPurchased || BigInt(0);
  
  await prisma.subscription.update({
    where: { id: subscription.id },
      data: {
        plan: 'free',
        status: 'cancelled',
        stripeSubscriptionId: null,
        // tokensLimit = free plan base + extra purchased tokens (preserved)
        tokensLimit: BigInt(PLAN_CONFIG.free.tokensLimit) + extraTokens,
        exportsLimit: PLAN_CONFIG.free.exportLimit, // 2 exports for free plan
        cancelAtPeriodEnd: false,
      },
  });
  
  console.log(`Subscription cancelled, downgraded to free: ${stripeSubscription.id}`);
}
