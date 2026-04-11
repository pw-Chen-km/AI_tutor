'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { X, Clock, AlertTriangle, Sparkles, Crown, Zap } from 'lucide-react';

interface TrialInfo {
  isTrial: boolean;
  trialEndsAt: string | null;
  trialPlan: string | null;
  daysRemaining: number;
  isExpired: boolean;
}

export function TrialExpiryModal() {
  const { data: session } = useSession();
  const [trialInfo, setTrialInfo] = useState<TrialInfo | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!session?.user?.id) return;

    const checkTrialStatus = async () => {
      try {
        const response = await fetch('/api/subscription');
        if (response.ok) {
          const data = await response.json();
          
          if (data.isTrial) {
            const trialEndsAt = data.trialEndsAt ? new Date(data.trialEndsAt) : null;
            const now = new Date();
            const daysRemaining = trialEndsAt 
              ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
              : 0;
            const isExpired = trialEndsAt ? trialEndsAt < now : false;

            setTrialInfo({
              isTrial: true,
              trialEndsAt: data.trialEndsAt,
              trialPlan: data.trialPlan || data.plan,
              daysRemaining,
              isExpired,
            });

            // 顯示 modal 條件：
            // 1. 已過期
            // 2. 剩餘天數 <= 3 天
            // 3. 尚未被關閉過（本次 session）
            const dismissedKey = `trial_modal_dismissed_${session.user.id}`;
            const wasDismissed = sessionStorage.getItem(dismissedKey);
            
            if (!wasDismissed && (isExpired || daysRemaining <= 3)) {
              setShowModal(true);
            }
          }
        }
      } catch (error) {
        console.error('Failed to check trial status:', error);
      }
    };

    checkTrialStatus();
  }, [session]);

  const handleDismiss = () => {
    if (session?.user?.id) {
      sessionStorage.setItem(`trial_modal_dismissed_${session.user.id}`, 'true');
    }
    setShowModal(false);
    setDismissed(true);
  };

  if (!showModal || !trialInfo) return null;

  const planIcon = trialInfo.trialPlan === 'pro' 
    ? <Crown className="w-8 h-8 text-white" />
    : <Sparkles className="w-8 h-8 text-white" />;

  const planGradient = trialInfo.trialPlan === 'pro'
    ? 'from-purple-500 to-pink-600'
    : 'from-blue-500 to-indigo-600';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
      <Card className="w-full max-w-md bg-slate-800/95 border-slate-700/50 shadow-2xl animate-scale-in">
        <CardHeader className="relative pb-4">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 h-8 w-8 text-slate-400 hover:text-white"
            onClick={handleDismiss}
          >
            <X className="w-5 h-5" />
          </Button>
          
          <div className="flex flex-col items-center text-center">
            <div className={`p-4 rounded-2xl bg-gradient-to-br ${planGradient} mb-4 shadow-lg`}>
              {trialInfo.isExpired ? (
                <AlertTriangle className="w-8 h-8 text-white" />
              ) : (
                <Clock className="w-8 h-8 text-white" />
              )}
            </div>
            
            <CardTitle className="text-xl text-white">
              {trialInfo.isExpired 
                ? 'Your Trial Has Ended'
                : `${trialInfo.daysRemaining} Day${trialInfo.daysRemaining !== 1 ? 's' : ''} Left in Your Trial`
              }
            </CardTitle>
            
            <CardDescription className="text-slate-400 mt-2">
              {trialInfo.isExpired 
                ? 'Subscribe now to continue using all features'
                : `Your ${trialInfo.trialPlan?.toUpperCase()} trial expires on ${
                    trialInfo.trialEndsAt 
                      ? new Date(trialInfo.trialEndsAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'soon'
                  }`
              }
            </CardDescription>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {/* Features reminder */}
          <div className="bg-slate-900/50 rounded-xl p-4 space-y-2">
            <p className="text-sm text-slate-300 font-medium">
              {trialInfo.isExpired 
                ? 'Your account will be converted to Free plan with limited features'
                : 'Keep these premium features by subscribing:'
              }
            </p>
            <ul className="text-sm text-slate-400 space-y-1">
              <li className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-cyan-400" />
                {trialInfo.trialPlan === 'pro' ? '2M tokens/month' : '500K tokens/month'}
              </li>
              <li className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-cyan-400" />
                All modules & features
              </li>
              {trialInfo.trialPlan === 'pro' && (
                <>
                  <li className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-cyan-400" />
                    Web Search & Enrichment
                  </li>
                  <li className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-cyan-400" />
                    Priority Support
                  </li>
                </>
              )}
            </ul>
          </div>
          
          {/* CTA Buttons */}
          <div className="space-y-2">
            <Link href="/billing" className="block">
              <Button 
                className={`w-full h-12 bg-gradient-to-r ${planGradient} hover:opacity-90 text-white font-medium`}
              >
                {trialInfo.isExpired ? 'Subscribe Now' : 'View Plans & Subscribe'}
              </Button>
            </Link>
            
            {!trialInfo.isExpired && (
              <Button 
                variant="ghost" 
                className="w-full text-slate-400 hover:text-white"
                onClick={handleDismiss}
              >
                Remind Me Later
              </Button>
            )}
          </div>
          
          {trialInfo.isExpired && (
            <p className="text-xs text-center text-slate-500">
              Your account will be limited to Free plan features until you subscribe
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Trial badge for sidebar - shows remaining days
 */
export function TrialBadge() {
  const { data: session } = useSession();
  const [trialInfo, setTrialInfo] = useState<TrialInfo | null>(null);

  useEffect(() => {
    if (!session?.user?.id) return;

    const checkTrialStatus = async () => {
      try {
        const response = await fetch('/api/subscription');
        if (response.ok) {
          const data = await response.json();
          
          // Don't show trial badge if user has an active paid subscription
          // Check if they have a non-free, non-trial plan with active status
          const paidPlans = ['plus', 'pro', 'premium'];
          const hasPaidSubscription = paidPlans.includes(data.plan?.toLowerCase()) && 
            data.status === 'active' && 
            !data.isTrial;
          
          if (hasPaidSubscription) {
            // User has paid subscription, don't show trial badge
            setTrialInfo(null);
            return;
          }
          
          if (data.isTrial) {
            const trialEndsAt = data.trialEndsAt ? new Date(data.trialEndsAt) : null;
            const now = new Date();
            const daysRemaining = trialEndsAt 
              ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
              : 0;
            const isExpired = trialEndsAt ? trialEndsAt < now : false;

            setTrialInfo({
              isTrial: true,
              trialEndsAt: data.trialEndsAt,
              trialPlan: data.trialPlan || data.plan,
              daysRemaining,
              isExpired,
            });
          } else {
            setTrialInfo(null);
          }
        }
      } catch (error) {
        console.error('Failed to check trial status:', error);
      }
    };

    checkTrialStatus();
  }, [session]);

  if (!trialInfo) return null;

  const badgeColor = trialInfo.isExpired 
    ? 'bg-red-500/20 text-red-400 border-red-500/30'
    : trialInfo.daysRemaining <= 3 
    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
    : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';

  return (
    <Link href="/billing">
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${badgeColor} hover:opacity-80 transition-opacity cursor-pointer`}>
        <Clock className="w-4 h-4" />
        <div className="text-xs">
          <div className="font-medium">
            {trialInfo.isExpired 
              ? 'Trial Expired'
              : `${trialInfo.daysRemaining}d left`
            }
          </div>
          <div className="opacity-70">{trialInfo.trialPlan?.toUpperCase()} Trial</div>
        </div>
      </div>
    </Link>
  );
}
