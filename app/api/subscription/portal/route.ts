import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';
import { createBillingPortalSession } from '@/lib/payments/stripe';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
    });
    
    if (!subscription?.stripeCustomerId) {
      return NextResponse.json({ error: 'No Stripe customer found' }, { status: 404 });
    }
    
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    const portalUrl = await createBillingPortalSession(
      subscription.stripeCustomerId,
      `${baseUrl}/billing`
    );
    
    return NextResponse.json({ url: portalUrl });
  } catch (error: any) {
    console.error('Portal API error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create portal session' }, { status: 500 });
  }
}
