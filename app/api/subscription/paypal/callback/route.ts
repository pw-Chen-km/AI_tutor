import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';
import { getPayPalSubscription, getPlanFromPayPalId } from '@/lib/payments/paypal';
import { PLAN_CONFIG } from '@/lib/db/schema';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const subscriptionId = req.nextUrl.searchParams.get('subscription_id');
    const token = req.nextUrl.searchParams.get('token'); // PayPal provides this
    
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    if (!session?.user?.id) {
      return NextResponse.redirect(new URL('/login', baseUrl));
    }
    
    if (!subscriptionId && !token) {
      return NextResponse.redirect(new URL('/billing?error=missing-subscription', baseUrl));
    }
    
    // Get the subscription details from PayPal
    const paypalSubscription = await getPayPalSubscription(subscriptionId || token!);
    
    if (paypalSubscription.status !== 'ACTIVE' && paypalSubscription.status !== 'APPROVED') {
      console.log('PayPal subscription not active:', paypalSubscription.status);
      return NextResponse.redirect(new URL('/billing?error=subscription-not-active', baseUrl));
    }
    
    const plan = getPlanFromPayPalId(paypalSubscription.plan_id);
    
    if (!plan) {
      console.error('Unknown PayPal plan ID:', paypalSubscription.plan_id);
      return NextResponse.redirect(new URL('/billing?error=unknown-plan', baseUrl));
    }
    
    const planConfig = PLAN_CONFIG[plan];
    
    // Update subscription in database
    await prisma.subscription.upsert({
      where: { userId: session.user.id },
      update: {
        plan,
        status: 'active',
        paypalSubscriptionId: paypalSubscription.id,
        tokensLimit: BigInt(planConfig.tokensLimit),
        exportsLimit: planConfig.exportLimit ?? null,
        tokensUsed: 0,
        exportsUsed: 0,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      create: {
        userId: session.user.id,
        plan,
        status: 'active',
        paypalSubscriptionId: paypalSubscription.id,
        tokensLimit: BigInt(planConfig.tokensLimit),
        exportsLimit: planConfig.exportLimit ?? null,
      },
    });
    
    return NextResponse.redirect(new URL('/billing?success=true', baseUrl));
  } catch (error: any) {
    console.error('PayPal callback error:', error);
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    return NextResponse.redirect(new URL(`/billing?error=${encodeURIComponent(error.message)}`, baseUrl));
  }
}
