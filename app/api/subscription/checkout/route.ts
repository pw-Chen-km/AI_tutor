import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';
import { 
  createCheckoutSession, 
  createStripeCustomer, 
  updateSubscriptionPlan,
  cancelStripeSubscription,
  cancelAllOtherSubscriptions
} from '@/lib/payments/stripe';
import { PLAN_CONFIG, type PlanType } from '@/lib/db/schema';

// Plan order for comparison
const PLAN_ORDER = ['free', 'plus', 'pro', 'premium'];

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { plan } = await req.json();
    
    // Validate plan (now includes 'free' for downgrade)
    if (!plan || !['free', 'plus', 'pro', 'premium'].includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }
    
    // Get subscription record
    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
    });
    
    const currentPlan = subscription?.plan || 'free';
    const currentPlanIndex = PLAN_ORDER.indexOf(currentPlan);
    const targetPlanIndex = PLAN_ORDER.indexOf(plan);
    const isDowngrade = currentPlanIndex > targetPlanIndex;
    const isUpgrade = currentPlanIndex < targetPlanIndex;
    
    // Handle downgrade to free plan
    if (plan === 'free') {
      if (!subscription?.stripeSubscriptionId) {
        return NextResponse.json({ error: 'No active subscription to downgrade' }, { status: 400 });
      }
      
      // Cancel subscription at period end (user keeps access until then)
      await cancelStripeSubscription(subscription.stripeSubscriptionId, true);
      
      // Update local record to mark as cancelling
      await prisma.subscription.update({
        where: { userId: session.user.id },
        data: { 
          cancelAtPeriodEnd: true,
          // Plan will change to 'free' when period ends (handled by webhook)
        },
      });
      
      return NextResponse.json({ 
        success: true, 
        message: 'Your subscription will be downgraded to Free at the end of your current billing period.' 
      });
    }
    
    // Handle downgrade to a lower paid plan (plus, pro)
    // Immediate change with proration - ensures max 2 months subscription
    if (isDowngrade && subscription?.stripeSubscriptionId) {
      // Update subscription to new plan - immediate effect with proration
      await updateSubscriptionPlan(subscription.stripeSubscriptionId, plan as PlanType, false);
      
      // Update local record immediately
      const planConfig = PLAN_CONFIG[plan as PlanType];
      await prisma.subscription.update({
        where: { userId: session.user.id },
        data: { 
          plan: plan as PlanType,
          tokensLimit: BigInt(planConfig.tokensLimit) + (subscription.extraTokensPurchased || BigInt(0)),
          exportsLimit: planConfig.exportLimit ?? null,
          cancelAtPeriodEnd: false,
        },
      });
      
      return NextResponse.json({ 
        success: true, 
        message: `Your plan has been changed to ${planConfig.name}. The change is effective immediately with prorated billing.` 
      });
    }
    
    // Handle upgrade - needs checkout session
    // Ensure we have a Stripe customer ID
    let customerId = subscription?.stripeCustomerId;
    
    if (!customerId) {
      customerId = await createStripeCustomer(session.user.email, session.user.name || undefined);
      
      if (subscription) {
        await prisma.subscription.update({
          where: { userId: session.user.id },
          data: { stripeCustomerId: customerId },
        });
      }
    }
    
    // IMPORTANT: Cancel all existing subscriptions before creating a new one
    // This ensures maximum 2 months subscription (current + next month)
    // Prevents duplicate subscriptions and overlapping billing periods
    if (customerId) {
      const cancelledCount = await cancelAllOtherSubscriptions(customerId);
      if (cancelledCount > 0) {
        console.log(`[Checkout] Cancelled ${cancelledCount} existing subscription(s) for customer ${customerId} to prevent overlap`);
      }
    }
    
    // If user already has an active subscription, we can update it instead of creating new
    // This ensures only one subscription exists
    if (subscription?.stripeSubscriptionId && isUpgrade) {
      try {
        // Update existing subscription to new plan immediately
        await updateSubscriptionPlan(subscription.stripeSubscriptionId, plan as PlanType, false);
        
        // Update local record immediately
        const planConfig = PLAN_CONFIG[plan as PlanType];
        await prisma.subscription.update({
          where: { userId: session.user.id },
          data: {
            plan: plan as PlanType,
            tokensLimit: BigInt(planConfig.tokensLimit) + (subscription.extraTokensPurchased || BigInt(0)),
            exportsLimit: planConfig.exportLimit ?? null,
            cancelAtPeriodEnd: false,
          },
        });
        
        return NextResponse.json({ 
          success: true, 
          message: `Your plan has been upgraded to ${planConfig.name}. The change is effective immediately with prorated billing.` 
        });
      } catch (error) {
        console.error('[Checkout] Failed to update existing subscription, falling back to checkout:', error);
        // Fall through to create new checkout session
      }
    }
    
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    const checkoutUrl = await createCheckoutSession({
      userId: session.user.id,
      email: session.user.email,
      plan: plan as PlanType,
      customerId,
      successUrl: `${baseUrl}/billing?success=true`,
      cancelUrl: `${baseUrl}/billing?cancelled=true`,
    });
    
    return NextResponse.json({ url: checkoutUrl });
  } catch (error: any) {
    console.error('Checkout API error:', error);
    return NextResponse.json({ error: error.message || 'Failed to process plan change' }, { status: 500 });
  }
}
