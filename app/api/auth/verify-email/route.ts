import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/client';

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');
    
    if (!token) {
      return NextResponse.redirect(new URL('/login?error=missing-token', req.url));
    }
    
    // Find the verification token
    const verificationToken = await prisma.verificationToken.findUnique({
      where: { token },
    });
    
    if (!verificationToken) {
      return NextResponse.redirect(new URL('/login?error=invalid-token', req.url));
    }
    
    // Check if token has expired
    if (verificationToken.expires < new Date()) {
      // Delete expired token
      await prisma.verificationToken.delete({
        where: { token },
      });
      return NextResponse.redirect(new URL('/login?error=expired-token', req.url));
    }
    
    // Find and verify the user
    const user = await prisma.user.findUnique({
      where: { email: verificationToken.identifier },
    });
    
    if (!user) {
      return NextResponse.redirect(new URL('/login?error=user-not-found', req.url));
    }
    
    // Mark email as verified
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
    });
    
    // Delete the used token
    await prisma.verificationToken.delete({
      where: { token },
    });
    
    return NextResponse.redirect(new URL('/login?verified=true', req.url));
  } catch (error: any) {
    console.error('Email verification error:', error);
    return NextResponse.redirect(new URL('/login?error=verification-failed', req.url));
  }
}
