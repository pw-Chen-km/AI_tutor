import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { updateAutoTopUp } from '@/lib/payments/usage-tracker';

/**
 * Update auto top-up configuration
 * POST /api/subscription/auto-topup
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await req.json();
    const { enabled, amount, price } = body;
    
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }
    
    // If enabling, amount and price are required
    if (enabled && (amount === undefined || price === undefined)) {
      return NextResponse.json({ error: 'amount and price are required when enabling auto top-up' }, { status: 400 });
    }
    
    await updateAutoTopUp(
      session.user.id,
      enabled,
      amount,
      price
    );
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Auto top-up update error:', error);
    return NextResponse.json(
      { error: 'Failed to update auto top-up', message: error.message },
      { status: 500 }
    );
  }
}
