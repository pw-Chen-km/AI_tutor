import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import prisma from '@/lib/db/client';
import { verifyPayPalWebhook, getPlanFromPayPalId, getPayPalSubscription } from '@/lib/payments/paypal';
import { PLAN_CONFIG } from '@/lib/db/schema';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const headersList = await headers();
  
  // Get PayPal headers
  const paypalHeaders: Record<string, string> = {
    'paypal-auth-algo': headersList.get('paypal-auth-algo') || '',
    'paypal-cert-url': headersList.get('paypal-cert-url') || '',
    'paypal-transmission-id': headersList.get('paypal-transmission-id') || '',
    'paypal-transmission-sig': headersList.get('paypal-transmission-sig') || '',
    'paypal-transmission-time': headersList.get('paypal-transmission-time') || '',
  };
  
  // Verify webhook signature (optional in sandbox)
  const isValid = await verifyPayPalWebhook(paypalHeaders, body);
  
  if (!isValid && process.env.NODE_ENV === 'production') {
    console.error('PayPal webhook signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
  
  try {
    const event = JSON.parse(body);
    
    switch (event.event_type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        await handleSubscriptionActivated(event.resource);
        break;
      }
      
      case 'BILLING.SUBSCRIPTION.CANCELLED': {
        await handleSubscriptionCancelled(event.resource);
        break;
      }
      
      case 'BILLING.SUBSCRIPTION.SUSPENDED': {
        await handleSubscriptionSuspended(event.resource);
        break;
      }
      
      case 'PAYMENT.SALE.COMPLETED': {
        await handlePaymentCompleted(event.resource);
        break;
      }
      
      default:
        console.log(`Unhandled PayPal event type: ${event.event_type}`);
    }
    
    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('PayPal webhook handler error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handleSubscriptionActivated(resource: any) {
  const subscriptionId = resource.id;
  const userId = resource.custom_id;
  const planId = resource.plan_id;
  
  if (!userId) {
    console.error('Missing userId in PayPal subscription');
    return;
  }
  
  const plan = getPlanFromPayPalId(planId);
  
  if (!plan) {
    console.error(`Unknown PayPal plan ID: ${planId}`);
    return;
  }
  
  const planConfig = PLAN_CONFIG[plan];
  
  await prisma.subscription.upsert({
    where: { userId },
    update: {
      plan,
      status: 'active',
      paypalSubscriptionId: subscriptionId,
      tokensLimit: BigInt(planConfig.tokensLimit),
      exportsLimit: planConfig.exportLimit ?? null,
      tokensUsed: 0,
      exportsUsed: 0,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    create: {
      userId,
      plan,
      status: 'active',
      paypalSubscriptionId: subscriptionId,
      tokensLimit: BigInt(planConfig.tokensLimit),
      exportsLimit: planConfig.exportLimit ?? null,
    },
  });
  
  console.log(`PayPal subscription activated for user ${userId}: ${plan}`);
}

async function handleSubscriptionCancelled(resource: any) {
  const subscriptionId = resource.id;
  
  const subscription = await prisma.subscription.findUnique({
    where: { paypalSubscriptionId: subscriptionId },
  });
  
  if (!subscription) {
    console.log(`No subscription found for PayPal subscription: ${subscriptionId}`);
    return;
  }
  
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      plan: 'free',
      status: 'cancelled',
      paypalSubscriptionId: null,
      tokensLimit: BigInt(PLAN_CONFIG.free.tokensLimit),
    },
  });
  
  console.log(`PayPal subscription cancelled: ${subscriptionId}`);
}

async function handleSubscriptionSuspended(resource: any) {
  const subscriptionId = resource.id;
  
  const subscription = await prisma.subscription.findUnique({
    where: { paypalSubscriptionId: subscriptionId },
  });
  
  if (!subscription) return;
  
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'past_due',
    },
  });
  
  console.log(`PayPal subscription suspended: ${subscriptionId}`);
}

async function handlePaymentCompleted(resource: any) {
  const subscriptionId = resource.billing_agreement_id;
  
  if (!subscriptionId) return;
  
  const subscription = await prisma.subscription.findUnique({
    where: { paypalSubscriptionId: subscriptionId },
  });
  
  if (!subscription) return;
  
  // Reset tokens on payment
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'active',
      tokensUsed: 0,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  
  // Create payment record
  await prisma.paymentRecord.create({
    data: {
      userId: subscription.userId,
      provider: 'paypal',
      providerPaymentId: resource.id,
      amount: parseFloat(resource.amount?.total || '0'),
      currency: resource.amount?.currency || 'USD',
      status: 'succeeded',
      metadata: {
        subscriptionId,
        paypalTransactionId: resource.id,
      },
    },
  });
  
  console.log(`PayPal payment completed for subscription: ${subscriptionId}`);
}
