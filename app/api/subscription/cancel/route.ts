import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';
import { cancelStripeSubscription, resumeStripeSubscription } from '@/lib/payments/stripe';

// Cancel subscription
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { immediate } = await req.json();
    
    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
    });
    
    if (!subscription?.stripeSubscriptionId) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }
    
    await cancelStripeSubscription(subscription.stripeSubscriptionId, !immediate);
    
    await prisma.subscription.update({
      where: { userId: session.user.id },
      data: {
        cancelAtPeriodEnd: !immediate,
        ...(immediate ? { status: 'cancelled', plan: 'free' } : {}),
      },
    });
    
    return NextResponse.json({ success: true, cancelAtPeriodEnd: !immediate });
  } catch (error: any) {
    console.error('Cancel API error:', error);
    return NextResponse.json({ error: error.message || 'Failed to cancel subscription' }, { status: 500 });
  }
}

// Resume cancelled subscription
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
    });
    
    if (!subscription?.stripeSubscriptionId) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
    }
    
    if (!subscription.cancelAtPeriodEnd) {
      return NextResponse.json({ error: 'Subscription is not scheduled for cancellation' }, { status: 400 });
    }
    
    await resumeStripeSubscription(subscription.stripeSubscriptionId);
    
    await prisma.subscription.update({
      where: { userId: session.user.id },
      data: {
        cancelAtPeriodEnd: false,
      },
    });
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Resume API error:', error);
    return NextResponse.json({ error: error.message || 'Failed to resume subscription' }, { status: 500 });
  }
}
