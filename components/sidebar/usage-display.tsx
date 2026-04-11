'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Zap, TrendingUp, AlertTriangle } from 'lucide-react';

interface UsageInfo {
  tokensUsed: number;
  tokensLimit: number;
  tokensRemaining: number;
  usagePercentage: number;
  plan: string;
  canGenerate: boolean;
  isNearLimit: boolean;
}

export function UsageDisplay() {
  const { data: session } = useSession();
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (session?.user?.id) {
      fetchUsage();
    }
  }, [session?.user?.id]);
  
  const fetchUsage = async () => {
    try {
      const response = await fetch('/api/subscription/usage');
      if (response.ok) {
        const data = await response.json();
        setUsage(data);
      } else {
        console.error('Failed to fetch usage:', response.status, response.statusText);
        const errorData = await response.json().catch(() => ({}));
        console.error('Error details:', errorData);
      }
    } catch (error) {
      console.error('Failed to fetch usage:', error);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading || !usage) {
    return (
      <div className="p-3 bg-muted/30 rounded-lg animate-pulse">
        <div className="h-4 bg-muted rounded w-20 mb-2" />
        <div className="h-2 bg-muted rounded w-full" />
      </div>
    );
  }
  
  const formatTokens = (tokens: number) => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`;
    }
    if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(0)}K`;
    }
    return tokens.toString();
  };
  
  const getProgressColor = () => {
    if (usage.usagePercentage >= 90) return 'bg-red-500';
    if (usage.usagePercentage >= 75) return 'bg-amber-500';
    return 'bg-primary';
  };
  
  return (
    <div className="p-3 bg-muted/30 rounded-lg space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Zap className="w-4 h-4 text-primary" />
          Token Usage
        </div>
        <span className="text-xs font-medium text-muted-foreground capitalize px-2 py-0.5 bg-muted rounded">
          {usage.plan}
        </span>
      </div>
      
      {/* Progress bar */}
      <div className="relative h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 ${getProgressColor()}`}
          style={{ width: `${Math.min(100, usage.usagePercentage)}%` }}
        />
      </div>
      
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatTokens(usage.tokensUsed)} used</span>
        <span>{formatTokens(usage.tokensLimit)} limit</span>
      </div>
      
      {usage.isNearLimit && (
        <div className="flex items-center gap-1.5 text-xs text-amber-500 pt-1">
          <AlertTriangle className="w-3 h-3" />
          <span>{usage.usagePercentage >= 90 ? 'Almost out of tokens!' : 'Approaching limit'}</span>
        </div>
      )}
      
      {!usage.canGenerate && (
        <div className="flex items-center gap-1.5 text-xs text-red-500 pt-1">
          <AlertTriangle className="w-3 h-3" />
          <span>Token limit reached. Please upgrade.</span>
        </div>
      )}
    </div>
  );
}
