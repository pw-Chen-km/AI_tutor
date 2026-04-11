import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';

/**
 * 刪除用戶（僅限 Super User 或 Admin）
 * DELETE /api/admin/users?userId=xxx
 */
export async function DELETE(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
    }

    // 禁止刪除自己
    if (userId === session.user.id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isSuperUser: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 刪除用戶（Prisma cascade 會自動刪除關聯的 subscription, sessions, accounts 等）
    await prisma.user.delete({
      where: { id: userId },
    });

    return NextResponse.json({
      success: true,
      message: `User ${targetUser.email} deleted successfully`,
    });
  } catch (error: any) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * 獲取所有用戶資訊（僅限 Super User）
 * GET /api/admin/users
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

    // 檢查是否為 Super User
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isSuperUser: true, isAdmin: true },
    });

    if (!user?.isSuperUser && !user?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Super User access required' },
        { status: 403 }
      );
    }

    // 獲取所有用戶及其訂閱資訊
    const users = await prisma.user.findMany({
      include: {
        subscription: true,
        usageLogs: {
          select: {
            totalTokens: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        _count: {
          select: {
            usageLogs: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 計算統計資訊
    const stats = {
      totalUsers: users.length,
      totalSubscriptions: users.filter(u => u.subscription).length,
      subscriptionsByPlan: {
        free: users.filter(u => u.subscription?.plan === 'free').length,
        plus: users.filter(u => u.subscription?.plan === 'plus').length,
        pro: users.filter(u => u.subscription?.plan === 'pro').length,
        premium: users.filter(u => u.subscription?.plan === 'premium').length,
      },
      totalTokensUsed: users.reduce((sum, u) => {
        return sum + Number(u.subscription?.tokensUsed || 0);
      }, 0),
      totalTokensLimit: users.reduce((sum, u) => {
        return sum + Number(u.subscription?.tokensLimit || 0);
      }, 0),
    };

    // 格式化用戶資料
    const formattedUsers = users.map(user => {
      const totalTokensUsed = user.usageLogs.reduce((sum, log) => sum + log.totalTokens, 0);
      const tokensLimit = Number(user.subscription?.tokensLimit || 0);
      const tokensUsed = Number(user.subscription?.tokensUsed || 0);

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        isAdmin: user.isAdmin,
        isSuperUser: user.isSuperUser,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        subscription: user.subscription ? {
          plan: user.subscription.plan,
          status: user.subscription.status,
          tokensUsed: tokensUsed,
          tokensLimit: tokensLimit,
          tokensRemaining: tokensLimit - tokensUsed,
          usagePercentage: tokensLimit > 0 ? (tokensUsed / tokensLimit) * 100 : 0,
          currentPeriodStart: user.subscription.currentPeriodStart,
          currentPeriodEnd: user.subscription.currentPeriodEnd,
        } : null,
        usageStats: {
          totalLogs: user._count.usageLogs,
          totalTokensUsed: totalTokensUsed,
          lastActivity: user.usageLogs[0]?.createdAt || null,
        },
      };
    });

    return NextResponse.json({
      success: true,
      stats,
      users: formattedUsers,
      count: formattedUsers.length,
    });

  } catch (error: any) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
