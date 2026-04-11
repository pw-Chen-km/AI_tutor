import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/client';
import bcrypt from 'bcryptjs';

/**
 * 設定密碼（用於試用帳號）
 * POST /api/auth/setup-password
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, email, password } = body;

    if (!token || !email || !password) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // 密碼驗證
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
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
        { error: 'Invalid token' },
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
        { error: 'Token has expired' },
        { status: 400 }
      );
    }

    // 查找用戶
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 400 }
      );
    }

    // 加密密碼
    const passwordHash = await bcrypt.hash(password, 10);

    // 更新用戶密碼
    await prisma.user.update({
      where: { email },
      data: {
        passwordHash,
        emailVerified: new Date(), // 確保標記為已驗證
      },
    });

    // 刪除使用過的 token
    await prisma.verificationToken.delete({
      where: {
        identifier_token: {
          identifier: email,
          token,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Password set successfully',
    });

  } catch (error: any) {
    console.error('Error setting password:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
