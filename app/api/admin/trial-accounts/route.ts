import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';
import { PLAN_CONFIG, type PlanType } from '@/lib/db/schema';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { sendTrialAccountSetupEmail } from '@/lib/auth/email';

/**
 * 建立試用帳號
 * POST /api/admin/trial-accounts
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 檢查是否為 Super User 或 Admin
    const adminUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isSuperUser: true, isAdmin: true },
    });

    if (!adminUser?.isSuperUser && !adminUser?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { email, trialDays, plan, name } = body;

    // 驗證必要欄位
    if (!email || !trialDays || !plan) {
      return NextResponse.json(
        { error: 'Missing required fields: email, trialDays, plan' },
        { status: 400 }
      );
    }

    // 驗證試用期天數 (1-30)
    if (trialDays < 1 || trialDays > 30) {
      return NextResponse.json(
        { error: 'Trial days must be between 1 and 30' },
        { status: 400 }
      );
    }

    // 驗證方案 (只允許 plus 或 pro)
    if (!['plus', 'pro'].includes(plan)) {
      return NextResponse.json(
        { error: 'Trial plan must be either "plus" or "pro"' },
        { status: 400 }
      );
    }

    // 檢查 email 是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 409 }
      );
    }

    // 生成臨時密碼
    const tempPassword = randomBytes(12).toString('base64').slice(0, 16);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // 計算試用期結束日期
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

    // 取得方案配置
    const planConfig = PLAN_CONFIG[plan as PlanType];

    // 建立用戶和訂閱
    const newUser = await prisma.user.create({
      data: {
        email,
        name: name || null,
        passwordHash,
        emailVerified: new Date(), // 直接標記為已驗證
        subscription: {
          create: {
            plan: plan as PlanType,
            status: 'trialing',
            tokensLimit: BigInt(planConfig.tokensLimit),
            exportsLimit: planConfig.exportLimit,
            isTrial: true,
            trialEndsAt,
            trialPlan: plan as PlanType,
            createdByAdminId: session.user.id,
            currentPeriodStart: new Date(),
            currentPeriodEnd: trialEndsAt,
          },
        },
      },
      include: {
        subscription: true,
      },
    });

    // 建立密碼重設 token
    const resetToken = randomBytes(32).toString('hex');
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 48); // 48 小時有效

    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token: resetToken,
        expires: resetExpires,
      },
    });

    // 建立密碼設定連結
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const setupPasswordUrl = `${baseUrl}/setup-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    // 發送試用帳號設定郵件
    let emailSent = false;
    let emailError: string | null = null;
    
    try {
      await sendTrialAccountSetupEmail(email, resetToken, {
        name: name || undefined,
        plan,
        trialDays,
        trialEndsAt,
      });
      emailSent = true;
      console.log(`[Trial Account] Setup email sent to ${email}`);
    } catch (err: any) {
      console.error(`[Trial Account] Failed to send email to ${email}:`, err);
      emailError = err.message || 'Failed to send email';
    }

    return NextResponse.json({
      success: true,
      message: emailSent 
        ? 'Trial account created and setup email sent successfully' 
        : 'Trial account created, but email sending failed',
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        trialEndsAt,
        plan,
        trialDays,
      },
      emailSent,
      emailError,
      setupPasswordUrl,
      // 開發環境下顯示臨時密碼（生產環境應通過 email 發送）
      ...(process.env.NODE_ENV === 'development' && { tempPassword }),
    });

  } catch (error: any) {
    console.error('Error creating trial account:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * 獲取所有試用帳號
 * GET /api/admin/trial-accounts
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 檢查是否為 Super User 或 Admin
    const adminUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isSuperUser: true, isAdmin: true },
    });

    if (!adminUser?.isSuperUser && !adminUser?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    // 獲取所有試用帳號（排除已升級為付費方案的用戶：status=active 且 plan 為 premium/plus/pro）
    const paidPlans: Array<'premium' | 'plus' | 'pro'> = ['premium', 'plus', 'pro'];
    const trialAccounts = await prisma.subscription.findMany({
      where: {
        isTrial: true,
        OR: [
          { status: { not: 'active' } },
          { plan: { notIn: paidPlans } },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            createdAt: true,
            emailVerified: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 格式化回傳資料
    const formattedAccounts = trialAccounts.map((sub) => {
      const now = new Date();
      const trialEndsAt = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
      const daysRemaining = trialEndsAt 
        ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;
      const isExpired = trialEndsAt ? trialEndsAt < now : false;

      return {
        id: sub.id,
        userId: sub.userId,
        email: sub.user.email,
        name: sub.user.name,
        plan: sub.trialPlan || sub.plan,
        status: sub.status,
        trialEndsAt: sub.trialEndsAt,
        daysRemaining,
        isExpired,
        tokensUsed: Number(sub.tokensUsed),
        tokensLimit: Number(sub.tokensLimit),
        usagePercentage: Number(sub.tokensLimit) > 0 
          ? (Number(sub.tokensUsed) / Number(sub.tokensLimit)) * 100 
          : 0,
        createdAt: sub.createdAt,
        createdByAdminId: sub.createdByAdminId,
        emailVerified: sub.user.emailVerified !== null,
      };
    });

    // 統計資訊
    const stats = {
      total: formattedAccounts.length,
      active: formattedAccounts.filter(a => !a.isExpired && a.status === 'trialing').length,
      expired: formattedAccounts.filter(a => a.isExpired).length,
      byPlan: {
        plus: formattedAccounts.filter(a => a.plan === 'plus').length,
        pro: formattedAccounts.filter(a => a.plan === 'pro').length,
      },
    };

    return NextResponse.json({
      success: true,
      stats,
      accounts: formattedAccounts,
    });

  } catch (error: any) {
    console.error('Error fetching trial accounts:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * 刪除/取消試用帳號
 * DELETE /api/admin/trial-accounts
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 檢查是否為 Super User 或 Admin
    const adminUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isSuperUser: true, isAdmin: true },
    });

    if (!adminUser?.isSuperUser && !adminUser?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const action = searchParams.get('action') || 'convert'; // 'delete' 或 'convert'

    if (!userId) {
      return NextResponse.json(
        { error: 'Missing userId parameter' },
        { status: 400 }
      );
    }

    // 檢查用戶是否存在且為試用帳號
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (!subscription) {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      );
    }

    if (!subscription.isTrial) {
      return NextResponse.json(
        { error: 'This is not a trial account' },
        { status: 400 }
      );
    }

    if (action === 'delete') {
      // 完全刪除用戶
      await prisma.user.delete({
        where: { id: userId },
      });

      return NextResponse.json({
        success: true,
        message: 'Trial account deleted successfully',
        action: 'deleted',
      });
    } else {
      // 轉換為 free plan
      const freeConfig = PLAN_CONFIG.free;
      
      await prisma.subscription.update({
        where: { userId },
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
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Trial account converted to free plan',
        action: 'converted',
      });
    }

  } catch (error: any) {
    console.error('Error handling trial account:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * 更新試用帳號（延長試用期等）
 * PATCH /api/admin/trial-accounts
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 檢查是否為 Super User 或 Admin
    const adminUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isSuperUser: true, isAdmin: true },
    });

    if (!adminUser?.isSuperUser && !adminUser?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { userId, extendDays, newPlan } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'Missing userId' },
        { status: 400 }
      );
    }

    // 檢查用戶是否存在且為試用帳號
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
    });

    if (!subscription) {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      );
    }

    if (!subscription.isTrial) {
      return NextResponse.json(
        { error: 'This is not a trial account' },
        { status: 400 }
      );
    }

    const updateData: any = {};

    // 延長試用期
    if (extendDays && extendDays > 0) {
      const currentEndDate = subscription.trialEndsAt || new Date();
      const newEndDate = new Date(currentEndDate);
      newEndDate.setDate(newEndDate.getDate() + extendDays);
      updateData.trialEndsAt = newEndDate;
      updateData.currentPeriodEnd = newEndDate;
      
      // 如果已過期，重新啟用
      if (subscription.status !== 'trialing') {
        updateData.status = 'trialing';
      }
    }

    // 更改試用方案
    if (newPlan && ['plus', 'pro'].includes(newPlan)) {
      const planConfig = PLAN_CONFIG[newPlan as PlanType];
      updateData.trialPlan = newPlan;
      updateData.plan = newPlan;
      updateData.tokensLimit = BigInt(planConfig.tokensLimit);
      updateData.exportsLimit = planConfig.exportLimit;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid update parameters provided' },
        { status: 400 }
      );
    }

    const updatedSubscription = await prisma.subscription.update({
      where: { userId },
      data: updateData,
      include: { user: true },
    });

    return NextResponse.json({
      success: true,
      message: 'Trial account updated successfully',
      subscription: {
        userId: updatedSubscription.userId,
        email: updatedSubscription.user.email,
        plan: updatedSubscription.plan,
        trialEndsAt: updatedSubscription.trialEndsAt,
        status: updatedSubscription.status,
      },
    });

  } catch (error: any) {
    console.error('Error updating trial account:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
