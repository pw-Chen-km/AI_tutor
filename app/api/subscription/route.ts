import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';
import { PLAN_CONFIG } from '@/lib/db/schema';

// GET: Get current subscription info
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
    });
    
    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }
    
    const planConfig = PLAN_CONFIG[subscription.plan as keyof typeof PLAN_CONFIG];
    
    const exportsLimit = planConfig?.exportLimit ?? null;
    const exportsUsed = subscription.exportsUsed ?? 0;
    const exportsRemaining = exportsLimit === null ? null : Math.max(0, exportsLimit - exportsUsed);
    
    return NextResponse.json({
      id: subscription.id,
      plan: subscription.plan,
      planName: planConfig?.name || subscription.plan,
      status: subscription.status,
      tokensUsed: Number(subscription.tokensUsed),
      tokensLimit: Number(subscription.tokensLimit),
      tokensRemaining: Math.max(0, Number(subscription.tokensLimit) - Number(subscription.tokensUsed)),
      usagePercentage: Math.round((Number(subscription.tokensUsed) / Number(subscription.tokensLimit)) * 100),
      exportsUsed,
      exportsLimit,
      exportsRemaining,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      autoTopUpEnabled: subscription.autoTopUpEnabled ?? false,
      autoTopUpAmount: subscription.autoTopUpAmount,
      autoTopUpPrice: subscription.autoTopUpPrice ? Number(subscription.autoTopUpPrice) : null,
      features: planConfig?.features,
      pricing: {
        usd: planConfig?.priceUSD,
        twd: planConfig?.priceTWD,
      },
      // Trial account info
      isTrial: subscription.isTrial ?? false,
      trialEndsAt: subscription.trialEndsAt,
      trialPlan: subscription.trialPlan,
    });
  } catch (error: any) {
    console.error('Subscription GET error:', error);
    return NextResponse.json({ error: 'Failed to get subscription' }, { status: 500 });
  }
}
