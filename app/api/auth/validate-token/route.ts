import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/client';

/**
 * 驗證密碼設定 token
 * GET /api/auth/validate-token?token=xxx&email=xxx
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    const email = searchParams.get('email');

    if (!token || !email) {
      return NextResponse.json(
        { valid: false, error: 'Missing token or email' },
        { status: 400 }
      );
    }

    // 查找 verification token
    const verificationToken = await prisma.verificationToken.findFirst({
      where: {
        token,
        identifier: email,
      },
    });

    if (!verificationToken) {
      return NextResponse.json(
        { valid: false, error: 'Invalid token' },
        { status: 400 }
      );
    }

    // 檢查是否過期
    if (verificationToken.expires < new Date()) {
      // 刪除過期的 token
      await prisma.verificationToken.delete({
        where: {
          identifier_token: {
            identifier: email,
            token,
          },
        },
      });

      return NextResponse.json(
        { valid: false, error: 'Token has expired' },
        { status: 400 }
      );
    }

    // 檢查用戶是否存在
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json(
        { valid: false, error: 'User not found' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      valid: true,
      email: user.email,
    });

  } catch (error: any) {
    console.error('Error validating token:', error);
    return NextResponse.json(
      { valid: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
