import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { getUsageInfo, getUsageStats } from '@/lib/payments/usage-tracker';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const searchParams = req.nextUrl.searchParams;
    const includeStats = searchParams.get('stats') === 'true';
    const days = parseInt(searchParams.get('days') || '30');
    
    const usageInfo = await getUsageInfo(session.user.id);
    
    if (!usageInfo) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }
    
    let stats = null;
    if (includeStats) {
      stats = await getUsageStats(session.user.id, days);
    }
    
    return NextResponse.json({
      ...usageInfo,
      stats,
    });
  } catch (error: any) {
    console.error('Usage API error:', error);
    return NextResponse.json({ error: 'Failed to get usage info' }, { status: 500 });
  }
}
