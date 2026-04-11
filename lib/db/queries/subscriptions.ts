import prisma from '../client';
import { PLAN_CONFIG, type PlanType } from '../schema';
import type { Subscription, SubscriptionPlan, SubscriptionStatus } from '@prisma/client';

export async function getSubscriptionByUserId(userId: string): Promise<Subscription | null> {
  return prisma.subscription.findUnique({
    where: { userId },
  });
}

export async function getSubscriptionByStripeCustomerId(stripeCustomerId: string): Promise<Subscription | null> {
  return prisma.subscription.findUnique({
    where: { stripeCustomerId },
  });
}

export async function getSubscriptionByStripeSubscriptionId(stripeSubscriptionId: string): Promise<Subscription | null> {
  return prisma.subscription.findUnique({
    where: { stripeSubscriptionId },
  });
}

export async function createSubscription(data: {
  userId: string;
  plan?: SubscriptionPlan;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  paypalSubscriptionId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  extraTokensPurchased?: bigint;
}): Promise<Subscription> {
  const plan = data.plan || 'free';
  const planConfig = PLAN_CONFIG[plan as PlanType] || PLAN_CONFIG.free;
  const extraTokens = data.extraTokensPurchased || BigInt(0);
  const tokensLimit = BigInt(planConfig.tokensLimit) + extraTokens;
  const exportsLimit = planConfig.exportLimit ?? null;
  
  return prisma.subscription.create({
    data: {
      userId: data.userId,
      plan,
      status: 'active',
      tokensLimit,
      extraTokensPurchased: extraTokens,
      exportsLimit,
      stripeCustomerId: data.stripeCustomerId,
      stripeSubscriptionId: data.stripeSubscriptionId,
      stripePriceId: data.stripePriceId,
      paypalSubscriptionId: data.paypalSubscriptionId,
      currentPeriodStart: data.currentPeriodStart,
      currentPeriodEnd: data.currentPeriodEnd,
    },
  });
}

export async function updateSubscription(
  userId: string,
  data: Partial<{
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    stripePriceId: string;
    paypalSubscriptionId: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    tokensUsed: bigint;
    tokensLimit: bigint;
    extraTokensPurchased: bigint;
  }>
): Promise<Subscription> {
  // If plan is changing, update tokensLimit while preserving extraTokensPurchased
  if (data.plan && !data.tokensLimit) {
    const planConfig = PLAN_CONFIG[data.plan as PlanType] || PLAN_CONFIG.free;
    
    // Get current subscription to preserve extraTokensPurchased
    const currentSubscription = await prisma.subscription.findUnique({
      where: { userId },
      select: { extraTokensPurchased: true },
    });
    
    const extraTokens = currentSubscription?.extraTokensPurchased || BigInt(0);
    // tokensLimit = plan base tokens + extra purchased tokens
    data.tokensLimit = BigInt(planConfig.tokensLimit) + extraTokens;
  }
  
  return prisma.subscription.update({
    where: { userId },
    data,
  });
}

export async function incrementTokensUsed(
  userId: string,
  tokensToAdd: number
): Promise<Subscription> {
  return prisma.subscription.update({
    where: { userId },
    data: {
      tokensUsed: {
        increment: tokensToAdd,
      },
    },
  });
}

export async function resetTokensUsed(userId: string): Promise<Subscription> {
  return prisma.subscription.update({
    where: { userId },
    data: {
      tokensUsed: 0,
    },
  });
}

export async function cancelSubscription(userId: string, atPeriodEnd: boolean = true): Promise<Subscription> {
  if (atPeriodEnd) {
    return prisma.subscription.update({
      where: { userId },
      data: {
        cancelAtPeriodEnd: true,
      },
    });
  } else {
    // Get current subscription to preserve extraTokensPurchased
    const currentSubscription = await prisma.subscription.findUnique({
      where: { userId },
      select: { extraTokensPurchased: true },
    });
    
    const extraTokens = currentSubscription?.extraTokensPurchased || BigInt(0);
    
    return prisma.subscription.update({
      where: { userId },
      data: {
        status: 'cancelled',
        plan: 'free',
        // Preserve extra purchased tokens: plan base + extra
        tokensLimit: BigInt(PLAN_CONFIG.free.tokensLimit) + extraTokens,
        exportsLimit: PLAN_CONFIG.free.exportLimit,
        stripeSubscriptionId: null,
        paypalSubscriptionId: null,
      },
    });
  }
}

export async function getUsagePercentage(userId: string): Promise<number> {
  const subscription = await getSubscriptionByUserId(userId);
  if (!subscription) return 0;
  
  const used = Number(subscription.tokensUsed);
  const limit = Number(subscription.tokensLimit);
  
  if (limit === 0) return 100;
  return Math.round((used / limit) * 100);
}

export async function hasTokensRemaining(userId: string): Promise<boolean> {
  const subscription = await getSubscriptionByUserId(userId);
  if (!subscription) return false;
  
  return subscription.tokensUsed < subscription.tokensLimit;
}

export async function getTokensRemaining(userId: string): Promise<number> {
  const subscription = await getSubscriptionByUserId(userId);
  if (!subscription) return 0;
  
  const remaining = Number(subscription.tokensLimit) - Number(subscription.tokensUsed);
  return Math.max(0, remaining);
}
