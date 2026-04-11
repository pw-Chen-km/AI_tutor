import prisma from '@/lib/db/client';
import { PLAN_CONFIG, type PlanType } from '@/lib/db/schema';

export interface UsageInfo {
  tokensUsed: number;
  tokensLimit: number;
  tokensRemaining: number;
  usagePercentage: number;
  plan: string;
  canGenerate: boolean;
  isNearLimit: boolean;
  exportsUsed?: number;
  exportsLimit?: number | null;
  exportsRemaining?: number | null;
  canExport?: boolean;
}

/**
 * Get current usage information for a user
 */
export async function getUsageInfo(userId: string): Promise<UsageInfo | null> {
  // Check if user is super user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperUser: true },
  });
  
  // Super users have unlimited tokens
  if (user?.isSuperUser) {
    return {
      tokensUsed: 0,
      tokensLimit: 999999999999,
      tokensRemaining: 999999999999,
      usagePercentage: 0,
      plan: 'premium',
      canGenerate: true,
      isNearLimit: false,
    };
  }
  
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });
  
  if (!subscription) {
    return null;
  }
  
  const tokensUsed = Number(subscription.tokensUsed);
  const tokensLimit = Number(subscription.tokensLimit);
  const tokensRemaining = Math.max(0, tokensLimit - tokensUsed);
  const usagePercentage = tokensLimit > 0 ? Math.round((tokensUsed / tokensLimit) * 100) : 100;
  
  const planConfig = PLAN_CONFIG[subscription.plan as PlanType];
  const exportsLimit = planConfig?.exportLimit ?? null;
  const exportsUsed = subscription.exportsUsed ?? 0;
  const exportsRemaining = exportsLimit === null ? null : Math.max(0, exportsLimit - exportsUsed);
  const canExport = exportsLimit === null || exportsUsed < exportsLimit;
  
  return {
    tokensUsed,
    tokensLimit,
    tokensRemaining,
    usagePercentage,
    plan: subscription.plan,
    canGenerate: tokensUsed < tokensLimit,
    isNearLimit: usagePercentage >= 80,
    exportsUsed,
    exportsLimit,
    exportsRemaining,
    canExport,
  };
}

/**
 * Check if user has enough tokens for a generation request
 */
export async function checkTokensAvailable(userId: string, estimatedTokens: number = 5000): Promise<{ available: boolean; remaining: number }> {
  // Check if user is super user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperUser: true },
  });
  
  // Super users always have tokens available
  if (user?.isSuperUser) {
    return {
      available: true,
      remaining: 999999999999,
    };
  }
  
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });
  
  if (!subscription) {
    return { available: false, remaining: 0 };
  }
  
  const remaining = Number(subscription.tokensLimit) - Number(subscription.tokensUsed);
  return {
    available: remaining >= estimatedTokens,
    remaining: Math.max(0, remaining),
  };
}

/**
 * Record token usage after an LLM call
 */
export async function recordUsage(
  userId: string,
  module: string,
  inputTokens: number,
  outputTokens: number,
  model: string
): Promise<void> {
  const totalTokens = inputTokens + outputTokens;
  
  // Check if user is super user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperUser: true },
  });
  
  // Get or create subscription
  let subscription = await prisma.subscription.findUnique({
    where: { userId },
  });
  
  if (!subscription) {
    // Create a free subscription if none exists
      const planConfig = PLAN_CONFIG.free;
      subscription = await prisma.subscription.create({
        data: {
          userId,
          plan: 'free',
          status: 'active',
          tokensLimit: BigInt(planConfig.tokensLimit),
          exportsLimit: planConfig.exportLimit,
        },
      });
  }
  
  // Use a transaction to ensure consistency
  await prisma.$transaction([
    // Create usage log (always log for tracking)
    prisma.usageLog.create({
      data: {
        userId,
        subscriptionId: subscription.id,
        module,
        inputTokens,
        outputTokens,
        totalTokens,
        model,
      },
    }),
    // Increment tokens used (skip for super users)
    ...(user?.isSuperUser ? [] : [
      prisma.subscription.update({
        where: { userId },
        data: {
          tokensUsed: {
            increment: totalTokens,
          },
        },
      }),
    ]),
  ]);
}

/**
 * Get usage statistics for a time period
 */
export async function getUsageStats(userId: string, days: number = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const logs = await prisma.usageLog.findMany({
    where: {
      userId,
      createdAt: {
        gte: startDate,
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
  
  // Group by module
  const byModule: Record<string, { count: number; tokens: number }> = {};
  logs.forEach((log) => {
    if (!byModule[log.module]) {
      byModule[log.module] = { count: 0, tokens: 0 };
    }
    byModule[log.module].count += 1;
    byModule[log.module].tokens += log.totalTokens;
  });
  
  // Group by day
  const byDay: Record<string, number> = {};
  logs.forEach((log) => {
    const day = log.createdAt.toISOString().split('T')[0];
    byDay[day] = (byDay[day] || 0) + log.totalTokens;
  });
  
  return {
    totalLogs: logs.length,
    totalTokens: logs.reduce((sum, log) => sum + log.totalTokens, 0),
    byModule,
    byDay,
    recentLogs: logs.slice(0, 10),
  };
}

/**
 * Reset usage at the start of a new billing period
 */
export async function resetMonthlyUsage(userId: string): Promise<void> {
  await prisma.subscription.update({
    where: { userId },
    data: {
      tokensUsed: 0,
      exportsUsed: 0,
    },
  });
}

/**
 * Check if auto top-up should be triggered and process it
 */
export async function checkAndProcessAutoTopUp(userId: string): Promise<{ triggered: boolean; tokensAdded?: number }> {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });
  
  if (!subscription || !subscription.autoTopUpEnabled || !subscription.autoTopUpAmount) {
    return { triggered: false };
  }
  
  const tokensUsed = Number(subscription.tokensUsed);
  const tokensLimit = Number(subscription.tokensLimit);
  const remaining = tokensLimit - tokensUsed;
  
  // Only trigger if quota is exhausted or very low (less than 10K tokens)
  if (remaining > 10000) {
    return { triggered: false };
  }
  
  // Add tokens
  const tokensToAdd = BigInt(subscription.autoTopUpAmount);
  await prisma.subscription.update({
    where: { userId },
    data: {
      tokensLimit: {
        increment: tokensToAdd,
      },
    },
  });
  
  return {
    triggered: true,
    tokensAdded: subscription.autoTopUpAmount,
  };
}

/**
 * Update auto top-up configuration
 */
export async function updateAutoTopUp(
  userId: string,
  enabled: boolean,
  amount?: number,
  price?: number
): Promise<void> {
  await prisma.subscription.update({
    where: { userId },
    data: {
      autoTopUpEnabled: enabled,
      ...(amount !== undefined && { autoTopUpAmount: amount }),
      ...(price !== undefined && { autoTopUpPrice: price }),
    },
  });
}

/**
 * Check if user has access to a specific module based on their plan
 */
export function hasModuleAccess(plan: PlanType, module: string): boolean {
  const planConfig = PLAN_CONFIG[plan];
  if (!planConfig) return false;
  return planConfig.features.modules.includes(module);
}

/**
 * Check if user has export feature access
 */
export function hasExportAccess(plan: PlanType): boolean {
  const planConfig = PLAN_CONFIG[plan];
  return (planConfig?.exportLimit ?? 0) > 0 || planConfig?.exportLimit === null;
}

/**
 * Check if user can perform an export
 */
export async function checkExportAvailable(userId: string): Promise<{ available: boolean; remaining: number | null; limit: number | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperUser: true },
  });
  
  // Super users have unlimited exports
  if (user?.isSuperUser) {
    return {
      available: true,
      remaining: null,
      limit: null,
    };
  }
  
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });
  
  if (!subscription) {
    return { available: false, remaining: 0, limit: 0 };
  }
  
  const planConfig = PLAN_CONFIG[subscription.plan as PlanType];
  const exportsLimit = planConfig?.exportLimit ?? null;
  const exportsUsed = subscription.exportsUsed ?? 0;
  
  if (exportsLimit === null) {
    // Unlimited exports
    return { available: true, remaining: null, limit: null };
  }
  
  const remaining = Math.max(0, exportsLimit - exportsUsed);
  return {
    available: remaining > 0,
    remaining,
    limit: exportsLimit,
  };
}

/**
 * Record an export usage
 */
export async function recordExport(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperUser: true },
  });
  
  // Skip for super users
  if (user?.isSuperUser) {
    return;
  }
  
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });
  
  if (!subscription) {
    return;
  }
  
  const planConfig = PLAN_CONFIG[subscription.plan as PlanType];
  const exportsLimit = planConfig?.exportLimit ?? null;
  
  // If unlimited, no need to track
  if (exportsLimit === null) {
    return;
  }
  
  // Check if export is available
  const exportsUsed = subscription.exportsUsed ?? 0;
  if (exportsUsed >= exportsLimit) {
    throw new Error('Export limit reached');
  }
  
  // Increment export count
  await prisma.subscription.update({
    where: { userId },
    data: {
      exportsUsed: {
        increment: 1,
      },
    },
  });
}

/**
 * Calculate estimated cost for tokens (for overage billing)
 */
export function calculateOverageCost(tokensOver: number): number {
  const RATE_PER_1K = 0.005; // $0.005 per 1K tokens
  return Math.ceil(tokensOver / 1000) * RATE_PER_1K;
}
