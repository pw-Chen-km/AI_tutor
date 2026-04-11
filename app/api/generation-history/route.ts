import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import {
  getGenerationHistory,
  getGenerationHistoryCount,
  hasGenerationHistoryFeature,
  deleteGenerationHistory,
  clearAllGenerationHistory,
} from '@/lib/db/queries/generation-history';

// GET: Fetch user's generation history
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check if user has the feature
    const hasFeature = await hasGenerationHistoryFeature(session.user.id);
    
    if (!hasFeature) {
      return NextResponse.json({
        hasFeature: false,
        message: 'Generation history is only available for Premium users',
        history: [],
        count: 0,
      });
    }
    
    const [history, count] = await Promise.all([
      getGenerationHistory(session.user.id),
      getGenerationHistoryCount(session.user.id),
    ]);
    
    return NextResponse.json({
      hasFeature: true,
      history,
      count,
      limit: 50,
    });
  } catch (error: any) {
    console.error('Generation history GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch generation history' }, { status: 500 });
  }
}

// DELETE: Delete specific or all generation history
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { searchParams } = new URL(req.url);
    const historyId = searchParams.get('id');
    const clearAll = searchParams.get('clearAll') === 'true';
    
    if (clearAll) {
      // Clear all history
      const deletedCount = await clearAllGenerationHistory(session.user.id);
      return NextResponse.json({
        success: true,
        message: `Deleted ${deletedCount} files from history`,
        deletedCount,
      });
    }
    
    if (!historyId) {
      return NextResponse.json({ error: 'Missing history ID' }, { status: 400 });
    }
    
    const deleted = await deleteGenerationHistory(session.user.id, historyId);
    
    if (!deleted) {
      return NextResponse.json({ error: 'History entry not found' }, { status: 404 });
    }
    
    return NextResponse.json({
      success: true,
      message: 'File deleted from history',
      deleted,
    });
  } catch (error: any) {
    console.error('Generation history DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete generation history' }, { status: 500 });
  }
}
