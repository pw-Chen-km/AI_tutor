import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';
import { PLAN_CONFIG } from '@/lib/db/schema';

/**
 * 管理員手動觸發試用到期轉換
 * POST /api/admin/run-trial-expiry
 * 僅限 Super User 或 Admin
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isSuperUser: true, isAdmin: true },
    });

    if (!adminUser?.isSuperUser && !adminUser?.isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const now = new Date();

    const expiredTrials = await prisma.subscription.findMany({
      where: {
        isTrial: true,
        status: 'trialing',
        trialEndsAt: { lt: now },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (expiredTrials.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No expired trials to process',
        processed: 0,
        timestamp: now.toISOString(),
      });
    }

    const freeConfig = PLAN_CONFIG.free;
    const processedAccounts: Array<{
      userId: string;
      email: string | null;
      previousPlan: string;
      trialEndsAt: Date | null;
    }> = [];

    for (const subscription of expiredTrials) {
      try {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            plan: 'free',
            status: 'active',
            isTrial: false,
            trialEndsAt: null,
            trialPlan: null,
            tokensLimit: BigInt(freeConfig.tokensLimit),
            tokensUsed: BigInt(0),
            exportsLimit: freeConfig.exportLimit,
            exportsUsed: 0,
          },
        });

        processedAccounts.push({
          userId: subscription.userId,
          email: subscription.user.email,
          previousPlan: subscription.trialPlan || subscription.plan,
          trialEndsAt: subscription.trialEndsAt,
        });

        console.log(`[Trial Expiry] Converted user ${subscription.user.email} from trial ${subscription.trialPlan} to free plan`);
      } catch (err) {
        console.error(`[Trial Expiry] Error processing user ${subscription.userId}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${processedAccounts.length} expired trial accounts`,
      processed: processedAccounts.length,
      processedAccounts,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error('[Trial Expiry] Admin trigger error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
