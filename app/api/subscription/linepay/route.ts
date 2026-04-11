import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { createLinePayRequest } from '@/lib/payments/linepay';
import { type PlanType } from '@/lib/db/schema';

// Create Line Pay payment
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
    
    const { transactionId, paymentUrl } = await createLinePayRequest({
      userId: session.user.id,
      plan: plan as PlanType,
      confirmUrl: `${baseUrl}/api/subscription/linepay/confirm`,
      cancelUrl: `${baseUrl}/billing?cancelled=true`,
    });
    
    return NextResponse.json({ 
      transactionId,
      paymentUrl,
    });
  } catch (error: any) {
    console.error('Line Pay request error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create Line Pay request' }, { status: 500 });
  }
}
