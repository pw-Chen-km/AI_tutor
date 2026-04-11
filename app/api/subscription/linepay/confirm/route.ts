import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';
import { confirmLinePayPayment } from '@/lib/payments/linepay';
import { PLAN_CONFIG, type PlanType } from '@/lib/db/schema';

export async function GET(req: NextRequest) {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.redirect(new URL('/login', baseUrl));
    }
    
    const transactionId = req.nextUrl.searchParams.get('transactionId');
    const orderId = req.nextUrl.searchParams.get('orderId');
    const plan = req.nextUrl.searchParams.get('plan') as PlanType;
    const userId = req.nextUrl.searchParams.get('userId');
    
    if (!transactionId || !plan) {
      return NextResponse.redirect(new URL('/billing?error=missing-params', baseUrl));
    }
    
    // Verify the user matches
    if (userId !== session.user.id) {
      return NextResponse.redirect(new URL('/billing?error=user-mismatch', baseUrl));
    }
    
    const planConfig = PLAN_CONFIG[plan];
    
    if (!planConfig) {
      return NextResponse.redirect(new URL('/billing?error=invalid-plan', baseUrl));
    }
    
    const amount = planConfig.priceTWD || Math.round(planConfig.priceUSD * 32);
    
    // Confirm the payment with Line Pay
    const paymentInfo = await confirmLinePayPayment({
      transactionId,
      amount,
      currency: 'TWD',
    });
    
    // Update subscription
    await prisma.subscription.upsert({
      where: { userId: session.user.id },
      update: {
        plan,
        status: 'active',
        tokensLimit: BigInt(planConfig.tokensLimit),
        tokensUsed: 0,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      create: {
        userId: session.user.id,
        plan,
        status: 'active',
        tokensLimit: BigInt(planConfig.tokensLimit),
      },
    });
    
    // Create payment record
    await prisma.paymentRecord.create({
      data: {
        userId: session.user.id,
        provider: 'linepay',
        providerPaymentId: transactionId,
        amount,
        currency: 'TWD',
        status: 'succeeded',
        metadata: {
          orderId,
          plan,
          paymentInfo,
        },
      },
    });
    
    return NextResponse.redirect(new URL('/billing?success=true', baseUrl));
  } catch (error: any) {
    console.error('Line Pay confirmation error:', error);
    return NextResponse.redirect(new URL(`/billing?error=${encodeURIComponent(error.message)}`, baseUrl));
  }
}
