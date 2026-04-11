import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';

/**
 * 強制更新 session（重新獲取用戶資訊）
 * POST /api/auth/refresh-session
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

    // 返回成功，NextAuth 會在下次請求時自動更新 session
    return NextResponse.json({
      success: true,
      message: 'Session will be refreshed on next request',
    });
  } catch (error: any) {
    console.error('Refresh session error:', error);
    return NextResponse.json(
      { error: 'Failed to refresh session' },
      { status: 500 }
    );
  }
}
