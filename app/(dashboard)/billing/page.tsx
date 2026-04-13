'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Check, 
  Loader2, 
  Zap, 
  Crown, 
  Sparkles, 
  ArrowLeft, 
  CreditCard, 
  CheckCircle,
  XCircle,
  ExternalLink,
  History
} from 'lucide-react';
import { PLAN_CONFIG, EXTRA_TOKENS_CONFIG, type PlanType } from '@/lib/db/schema';

interface SubscriptionInfo {
  id: string;
  plan: PlanType;
  planName: string;
  status: string;
  tokensUsed: number;
  tokensLimit: number;
  tokensRemaining: number;
  usagePercentage: number;
  exportsUsed?: number;
  exportsLimit?: number | null;
  exportsRemaining?: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  autoTopUpEnabled?: boolean;
  autoTopUpAmount?: number | null;
  autoTopUpPrice?: number | null;
  features: {
    modules: string[];
    prioritySupport: boolean;
    customModel: boolean;
  };
  pricing: {
    usd: number;
    twd: number;
  };
}

const planIcons: Record<string, React.ReactNode> = {
  free: <Zap className="w-6 h-6" />,
  plus: <Sparkles className="w-6 h-6" />,
  pro: <Crown className="w-6 h-6" />,
  premium: <Crown className="w-6 h-6" />,
};

const planColors: Record<string, string> = {
  free: 'from-slate-500 to-slate-600',
  plus: 'from-blue-500 to-sky-500',
  pro: 'from-blue-600 to-indigo-600',
  premium: 'from-amber-500 to-orange-500',
};

// Module name mapping for display
const MODULE_NAMES: Record<string, string> = {
  drills: 'In-Class Drills',
  labs: 'Lab Practices',
  homework: 'Homework',
  exams: 'Exam Generator',
  lecture_rehearsal: 'Lecture Rehearsal',
  exam_evaluation: 'Exam Evaluation',
};

// Get modules for each plan
const getPlanModules = (plan: PlanType): string[] => {
  return [...PLAN_CONFIG[plan].features.modules] as string[];
};

function BillingPageContent() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAutoTopUp, setShowAutoTopUp] = useState(false);
  const [purchasingTokens, setPurchasingTokens] = useState<number | null>(null);
  const [hoveredModule, setHoveredModule] = useState<PlanType | null>(null);
  
  const success = searchParams.get('success');
  const cancelled = searchParams.get('cancelled');
  const tokensPurchased = searchParams.get('tokens');
  
  useEffect(() => {
    fetchSubscription();
    
    if (success) {
      const delays = [1000, 3000, 5000, 10000];
      delays.forEach((delay) => {
        setTimeout(() => {
          fetchSubscription();
        }, delay);
      });
    }
  }, [success]);
  
  const fetchSubscription = async () => {
    try {
      const response = await fetch('/api/subscription');
      if (response.ok) {
        const data = await response.json();
        setSubscription(data);
      }
    } catch (error) {
      console.error('Failed to fetch subscription:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleUpgrade = async (plan: PlanType) => {
    // Check if this is a downgrade
    const planOrder = ['free', 'plus', 'pro', 'premium'];
    const currentPlanIndex = subscription ? planOrder.indexOf(subscription.plan) : -1;
    const targetPlanIndex = planOrder.indexOf(plan);
    const isDowngrade = currentPlanIndex > targetPlanIndex;
    
    // Show confirmation for downgrade
    if (isDowngrade) {
      const confirmed = confirm(
        `Are you sure you want to downgrade to ${PLAN_CONFIG[plan].name}?\n\n` +
        `• Your current plan benefits will remain active until the end of your billing period\n` +
        `• The downgrade will take effect on ${subscription?.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : 'your next billing date'}\n` +
        `• You can upgrade again at any time`
      );
      if (!confirmed) return;
    }
    
    setActionLoading(plan);
    try {
      const response = await fetch('/api/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.url) {
          window.location.href = data.url;
        } else if (data.success) {
          // Direct plan change (e.g., downgrade scheduled)
          alert(data.message || 'Plan change scheduled successfully!');
          await fetchSubscription();
        }
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to process plan change');
      }
    } catch (error) {
      console.error('Plan change error:', error);
      alert('Failed to process plan change');
    } finally {
      setActionLoading(null);
    }
  };
  
  const handleManageSubscription = async () => {
    setActionLoading('portal');
    try {
      const response = await fetch('/api/subscription/portal', {
        method: 'POST',
      });
      
      if (response.ok) {
        const { url } = await response.json();
        window.location.href = url;
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to open billing portal');
      }
    } catch (error) {
      console.error('Portal error:', error);
      alert('Failed to open billing portal');
    } finally {
      setActionLoading(null);
    }
  };
  
  const handleCancelSubscription = async () => {
    if (!confirm('Are you sure you want to cancel your subscription? You will retain access until the end of your billing period.')) {
      return;
    }
    
    setActionLoading('cancel');
    try {
      const response = await fetch('/api/subscription/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ immediate: false }),
      });
      
      if (response.ok) {
        await fetchSubscription();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to cancel subscription');
      }
    } catch (error) {
      console.error('Cancel error:', error);
      alert('Failed to cancel subscription');
    } finally {
      setActionLoading(null);
    }
  };
  
  const handleResumeSubscription = async () => {
    setActionLoading('resume');
    try {
      const response = await fetch('/api/subscription/cancel', {
        method: 'DELETE',
      });
      
      if (response.ok) {
        await fetchSubscription();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to resume subscription');
      }
    } catch (error) {
      console.error('Resume error:', error);
      alert('Failed to resume subscription');
    } finally {
      setActionLoading(null);
    }
  };
  
  const handleUpdateAutoTopUp = async (enabled: boolean, amount?: number, price?: number) => {
    setActionLoading('autoTopUp');
    try {
      const response = await fetch('/api/subscription/auto-topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, amount, price }),
      });
      
      if (response.ok) {
        await fetchSubscription();
        setShowAutoTopUp(false);
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to update auto top-up');
      }
    } catch (error) {
      console.error('Auto top-up error:', error);
      alert('Failed to update auto top-up');
    } finally {
      setActionLoading(null);
    }
  };
  
  const handlePurchaseTokens = async (tokens: number) => {
    setPurchasingTokens(tokens);
    try {
      const response = await fetch('/api/subscription/purchase-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens }),
      });
      
      if (response.ok) {
        const data = await response.json();
        window.location.href = data.url;
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to create purchase session');
        setPurchasingTokens(null);
      }
    } catch (error) {
      console.error('Purchase tokens error:', error);
      alert('Failed to purchase tokens');
      setPurchasingTokens(null);
    }
  };
  
  const formatTokens = (tokens: number) => {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
    return tokens.toString();
  };
  
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };
  
  // Plan features for display
  const getPlanFeatures = (plan: PlanType) => {
    const features: Record<PlanType, string[]> = {
      free: [
        '50K tokens/month',
        '2 exports/month',
        'Basic modules access',
      ],
      plus: [
        '500K tokens/month',
        '10 exports/month',
        'Plus modules access',
      ],
      pro: [
        '2M tokens/month',
        '50 exports/month',
        'Web Search & Enrichment',
        'Pro modules access',
      ],
      premium: [
        '10M tokens/month',
        'Unlimited exports',
        'Web Search & Enrichment',
        '50 files generation history',
        'All modules',
      ],
    };
    return features[plan];
  };
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Subtle background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-blue-100/40 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-sky-100/40 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3" />
      </div>
      
      <div className="relative z-10 max-w-6xl mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Link href="/dashboard" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 mb-4 transition-colors cursor-pointer">
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
            <div className="flex items-center gap-3 mb-2">
              <Image src="/logo.png" alt="AsKura" width={40} height={40} className="w-10 h-10" />
              <h1 className="text-3xl font-bold text-slate-900">Subscription & Billing</h1>
            </div>
            <p className="text-slate-600 mt-1">Manage your plan and payment methods</p>
          </div>
        </div>
        
        {/* Success/Cancel Messages */}
        {success && (
          <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-medium">
                {tokensPurchased 
                  ? `Successfully purchased ${formatTokens(parseInt(tokensPurchased, 10))} tokens!`
                  : 'Your subscription has been activated successfully!'
                }
              </p>
              <p className="text-xs text-emerald-600 mt-1">
                If your plan hasn't updated yet, please wait a few seconds or refresh the page.
              </p>
            </div>
          </div>
        )}
        
        {cancelled && (
          <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700">
            <XCircle className="w-5 h-5 flex-shrink-0" />
            <p>Checkout was cancelled. No charges were made.</p>
          </div>
        )}
        
        {/* Current Plan Card */}
        {subscription && (
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200 shadow-lg shadow-slate-200/50">
            <CardHeader>
              <CardTitle className="text-slate-900 flex items-center gap-3">
                <div className={`p-3 rounded-xl bg-gradient-to-br ${planColors[subscription.plan]} text-white shadow-lg`}>
                  {planIcons[subscription.plan]}
                </div>
                <div>
                  <span className="text-2xl">{subscription.planName} Plan</span>
                  {subscription.cancelAtPeriodEnd && (
                    <span className="ml-3 px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full">
                      Cancels at period end
                    </span>
                  )}
                </div>
              </CardTitle>
              <CardDescription className="text-slate-600">
                {subscription.plan === 'free' 
                  ? 'Basic features with starter token allocation'
                  : `Active until ${formatDate(subscription.currentPeriodEnd)}`
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Usage Stats */}
              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <p className="text-sm text-slate-500 mb-1">Tokens Used</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {formatTokens(subscription.tokensUsed)}
                    <span className="text-sm text-slate-400 font-normal">
                      {' '}/ {formatTokens(subscription.tokensLimit)}
                    </span>
                  </p>
                  <div className="mt-2 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all ${
                        subscription.usagePercentage >= 90 ? 'bg-red-500' :
                        subscription.usagePercentage >= 75 ? 'bg-amber-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${Math.min(100, subscription.usagePercentage)}%` }}
                    />
                  </div>
                </div>
                
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <p className="text-sm text-slate-500 mb-1">Tokens Remaining</p>
                  <p className="text-2xl font-bold text-slate-900">{formatTokens(subscription.tokensRemaining)}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Resets on {formatDate(subscription.currentPeriodEnd)}
                  </p>
                </div>
                
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <p className="text-sm text-slate-500 mb-1">Monthly Cost</p>
                  <p className="text-2xl font-bold text-slate-900">
                    ${subscription.pricing.usd}
                    <span className="text-sm text-slate-400 font-normal">/mo</span>
                  </p>
                </div>
              </div>
              
              {/* Action Buttons */}
              {subscription.plan !== 'free' && (
                <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-200">
                  <Button
                    onClick={handleManageSubscription}
                    variant="outline"
                    className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors duration-200 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                    disabled={actionLoading === 'portal'}
                  >
                    {actionLoading === 'portal' ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CreditCard className="w-4 h-4 mr-2" />
                    )}
                    Manage Payment Method
                    <ExternalLink className="w-3 h-3 ml-2" />
                  </Button>
                  
                  {subscription.cancelAtPeriodEnd && (
                    <Button
                      onClick={handleResumeSubscription}
                      className="bg-blue-600 hover:bg-blue-700 text-white transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed"
                      disabled={actionLoading === 'resume'}
                    >
                      {actionLoading === 'resume' ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : null}
                      Resume Subscription
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
        
        {/* Buy Extra Tokens Section */}
        {subscription && subscription.plan !== 'free' && (
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200 shadow-lg shadow-slate-200/50">
            <CardHeader>
              <CardTitle className="text-slate-900 flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-500" />
                Buy Extra Tokens
              </CardTitle>
              <CardDescription className="text-slate-600">
                Purchase additional tokens to extend your quota. Prices include discounts based on your current plan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                {EXTRA_TOKENS_CONFIG.options.map((option) => {
                  const { priceUSD, discount, originalPrice } = EXTRA_TOKENS_CONFIG.calculatePrice(option.tokens);
                  const isPurchasing = purchasingTokens === option.tokens;
                  
                  return (
                    <Card
                      key={option.tokens}
                      className="bg-slate-50 border-slate-200 hover:border-blue-300 hover:shadow-md transition-all duration-200"
                    >
                      <CardContent className="p-4">
                        <div className="text-center">
                          <p className="text-sm text-slate-500 mb-1">{option.label}</p>
                          {discount > 0 && originalPrice > priceUSD && (
                            <p className="text-xs text-slate-400 line-through mb-1">
                              ${originalPrice.toFixed(2)}
                            </p>
                          )}
                          <p className="text-2xl font-bold text-slate-900 mb-1">
                            ${priceUSD.toFixed(2)}
                          </p>
                          {discount > 0 && (
                            <p className="text-xs text-emerald-600 font-medium mb-4">
                              Save {discount}%
                            </p>
                          )}
                          {discount === 0 && (
                            <p className="text-xs text-slate-400 mb-4">
                              &nbsp;
                            </p>
                          )}
                          <Button
                            onClick={() => handlePurchaseTokens(option.tokens)}
                            disabled={isPurchasing || !!purchasingTokens}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed"
                          >
                            {isPurchasing ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Processing...
                              </>
                            ) : (
                              <>
                                <Zap className="w-4 h-4 mr-2" />
                                Purchase
                              </>
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              
              <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">
                  <strong className="text-slate-700">Note:</strong> Purchased tokens are added to your current token limit and do not expire. 
                  They will be available immediately after payment confirmation.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Plan Comparison */}
        <div>
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            {subscription?.plan === 'free' ? 'Upgrade Your Plan' : 'Available Plans'}
          </h2>
          
          <div className="grid md:grid-cols-4 gap-4">
            {(['free', 'plus', 'pro', 'premium'] as PlanType[]).map((plan) => {
              const config = PLAN_CONFIG[plan];
              const isCurrentPlan = subscription?.plan === plan;
              // Correct plan order for upgrade/downgrade comparison
              const planOrder = ['free', 'plus', 'pro', 'premium'];
              const currentPlanIndex = subscription ? planOrder.indexOf(subscription.plan) : 0;
              const targetPlanIndex = planOrder.indexOf(plan);
              const isUpgrade = currentPlanIndex < targetPlanIndex;
              const isDowngrade = currentPlanIndex > targetPlanIndex;
              const features = getPlanFeatures(plan);
              const planModules = getPlanModules(plan);
              
              return (
                <Card 
                  key={plan} 
                  className={`relative bg-white border-slate-200 transition-all duration-300 flex flex-col ${
                    plan === 'pro' ? 'ring-2 ring-blue-500 shadow-xl shadow-blue-100/50' : ''
                  } ${isCurrentPlan ? 'ring-2 ring-emerald-500' : ''} hover:shadow-lg`}
                  style={{ minHeight: '500px' }}
                >
                  {plan === 'pro' && !isCurrentPlan && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-gradient-to-r from-blue-600 to-sky-500 rounded-full text-xs text-white font-medium shadow-md">
                      Most Popular
                    </div>
                  )}
                  
                  {isCurrentPlan && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-emerald-500 rounded-full text-xs text-white font-medium shadow-md">
                      Current Plan
                    </div>
                  )}
                  
                  <CardHeader className="text-center pb-4">
                    <div className={`mx-auto p-3 rounded-xl bg-gradient-to-br ${planColors[plan]} text-white w-fit mb-3 shadow-lg`}>
                      {planIcons[plan]}
                    </div>
                    <CardTitle className="text-slate-900 text-xl">{config.name}</CardTitle>
                    <div className="text-3xl font-bold text-slate-900 mt-2">
                      ${config.priceUSD}
                      <span className="text-sm text-slate-500 font-normal">/mo</span>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="space-y-4 flex-1 flex flex-col">
                    <ul className="space-y-2 text-sm flex-1">
                      {features.map((feature, index) => {
                        // Check if this is a modules access feature
                        const isModulesFeature = feature.includes('modules access') || feature.includes('All modules');
                        const isHovered = hoveredModule === plan && isModulesFeature;
                        
                        return (
                          <li 
                            key={index} 
                            className="flex items-start gap-2 text-slate-700 relative"
                            onMouseEnter={() => isModulesFeature ? setHoveredModule(plan) : undefined}
                            onMouseLeave={() => isModulesFeature ? setHoveredModule(null) : undefined}
                          >
                            <Check className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <span className={isModulesFeature ? 'cursor-help underline decoration-dotted' : ''}>
                                {feature}
                              </span>
                              {isHovered && isModulesFeature && (
                                <div className="absolute left-0 top-full mt-2 z-50 bg-slate-900 text-white text-xs rounded-lg shadow-xl p-3 min-w-[200px] border border-slate-700">
                                  <div className="font-semibold mb-2 text-white">
                                    {plan === 'free' ? 'Basic' : plan === 'plus' ? 'Plus' : plan === 'pro' ? 'Pro' : 'All'} Modules:
                                  </div>
                                  <ul className="space-y-1.5">
                                    {planModules.map((moduleId) => (
                                      <li key={moduleId} className="flex items-center gap-2 text-slate-200">
                                        <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                                        {MODULE_NAMES[moduleId] || moduleId}
                                      </li>
                                    ))}
                                  </ul>
                                  <div className="absolute -top-1 left-4 w-2 h-2 bg-slate-900 rotate-45 border-l border-t border-slate-700"></div>
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    
                    <div className="mt-auto pt-4">
                      {plan !== 'free' && !isCurrentPlan && (
                        <Button
                          onClick={() => handleUpgrade(plan)}
                          className={`w-full transition-all duration-200 cursor-pointer disabled:cursor-not-allowed ${
                            isUpgrade
                              ? plan === 'pro' 
                                ? 'bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-700 hover:to-sky-600 text-white shadow-md shadow-blue-500/20' 
                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                              : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                          }`}
                          disabled={actionLoading === plan}
                        >
                          {actionLoading === plan ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : null}
                          {isUpgrade ? `Upgrade to ${config.name}` : `Downgrade to ${config.name}`}
                        </Button>
                      )}
                      
                      {isCurrentPlan && (
                        <Button className="w-full cursor-not-allowed bg-slate-100 text-slate-500" disabled variant="outline">
                          Current Plan
                        </Button>
                      )}
                      
                      {plan === 'free' && !isCurrentPlan && (
                        <Button
                          onClick={() => handleUpgrade(plan)}
                          className="w-full bg-slate-200 hover:bg-slate-300 text-slate-700 transition-all duration-200 cursor-pointer disabled:cursor-not-allowed"
                          disabled={actionLoading === plan}
                        >
                          {actionLoading === plan ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : null}
                          Downgrade to Free
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
        
        {/* FAQ or Help */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200 shadow-lg shadow-slate-200/50">
          <CardHeader>
            <CardTitle className="text-slate-900">Need Help?</CardTitle>
          </CardHeader>
          <CardContent className="text-slate-600">
            <p>
              If you have questions about billing, subscriptions, or need to request a refund, 
              please contact our support team at{' '}
              <a href="mailto:support@askura.ai" className="text-blue-600 hover:underline">
                support@askura.ai
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    }>
      <BillingPageContent />
    </Suspense>
  );
}
