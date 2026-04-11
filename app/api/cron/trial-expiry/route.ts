import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/client';
import { PLAN_CONFIG } from '@/lib/db/schema';

/**
 * 處理試用期到期的 Cron Job
 * GET /api/cron/trial-expiry
 * 
 * 此端點可透過以下方式觸發：
 * 1. Vercel Cron (在 vercel.json 配置)
 * 2. 外部 cron 服務
 * 3. 手動觸發（需要 CRON_SECRET）
 * 
 * 處理邏輯：
 * - 找出所有已到期的試用帳號（trialEndsAt < 現在時間）
 * - 將這些帳號轉換為 free plan
 * - 保留帳號資料但限制功能
 */
export async function GET(req: NextRequest) {
  try {
    // 驗證 cron secret（用於安全性）
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    // 如果有設定 CRON_SECRET，則驗證
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const now = new Date();
    
    // 找出所有已到期的試用帳號
    const expiredTrials = await prisma.subscription.findMany({
      where: {
        isTrial: true,
        status: 'trialing',
        trialEndsAt: {
          lt: now,
        },
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

    // 取得 free plan 配置
    const freeConfig = PLAN_CONFIG.free;

    // 批量處理到期的試用帳號
    const processedAccounts: Array<{
      userId: string;
      email: string | null;
      previousPlan: string;
      trialEndsAt: Date | null;
    }> = [];

    for (const subscription of expiredTrials) {
      try {
        // 轉換為 free plan
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            plan: 'free',
            status: 'active',
            isTrial: false,
            trialEndsAt: null,
            trialPlan: null,
            tokensLimit: BigInt(freeConfig.tokensLimit),
            tokensUsed: BigInt(0), // 重設使用量
            exportsLimit: freeConfig.exportLimit,
            exportsUsed: 0,
            // 保留其他設定（如 createdByAdminId 作為記錄）
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

    // 找出即將到期的試用帳號（1天內到期）
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const expiringTomorrow = await prisma.subscription.findMany({
      where: {
        isTrial: true,
        status: 'trialing',
        trialEndsAt: {
          gte: now,
          lt: tomorrow,
        },
      },
      include: {
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: `Processed ${processedAccounts.length} expired trial accounts`,
      processed: processedAccounts.length,
      processedAccounts,
      expiringTomorrow: expiringTomorrow.length,
      expiringTomorrowEmails: expiringTomorrow.map(s => s.user.email),
      timestamp: now.toISOString(),
    });

  } catch (error: any) {
    console.error('[Trial Expiry] Cron job error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST 方法用於手動觸發（需要 Admin 權限）
 */
export async function POST(req: NextRequest) {
  try {
    // 從 body 取得 secret 或使用 header
    const body = await req.json().catch(() => ({}));
    const secret = body.secret;
    const cronSecret = process.env.CRON_SECRET;
    
    // 驗證
    if (cronSecret && secret !== cronSecret) {
      return NextResponse.json(
        { error: 'Invalid secret' },
        { status: 401 }
      );
    }

    // 呼叫 GET 方法的邏輯
    const response = await GET(req);
    return response;

  } catch (error: any) {
    console.error('[Trial Expiry] Manual trigger error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
