import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';
import { createPayPalSubscription, getPayPalSubscription, cancelPayPalSubscription } from '@/lib/payments/paypal';
import { PLAN_CONFIG, type PlanType } from '@/lib/db/schema';

// Create PayPal subscription
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { plan } = await req.json();
    
    if (!plan || !['plus', 'pro', 'premium'].includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }
    
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    const { subscriptionId, approvalUrl } = await createPayPalSubscription({
      userId: session.user.id,
      plan: plan as PlanType,
      returnUrl: `${baseUrl}/api/subscription/paypal/callback?subscription_id=${subscriptionId}`,
      cancelUrl: `${baseUrl}/billing?cancelled=true`,
    });
    
    return NextResponse.json({ 
      subscriptionId,
      approvalUrl,
    });
  } catch (error: any) {
    console.error('PayPal subscription creation error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create PayPal subscription' }, { status: 500 });
  }
}

// Cancel PayPal subscription
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
    });
    
    if (!subscription?.paypalSubscriptionId) {
      return NextResponse.json({ error: 'No PayPal subscription found' }, { status: 404 });
    }
    
    await cancelPayPalSubscription(subscription.paypalSubscriptionId);
    
    await prisma.subscription.update({
      where: { userId: session.user.id },
      data: {
        plan: 'free',
        status: 'cancelled',
        paypalSubscriptionId: null,
        tokensLimit: BigInt(PLAN_CONFIG.free.tokensLimit),
      },
    });
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('PayPal cancellation error:', error);
    return NextResponse.json({ error: error.message || 'Failed to cancel PayPal subscription' }, { status: 500 });
  }
}
