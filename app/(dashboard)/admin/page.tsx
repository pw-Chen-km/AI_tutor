'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Users, TrendingUp, Zap, Shield, Settings, ArrowLeft, UserPlus, Clock, AlertCircle, CheckCircle, X, Copy, ExternalLink, Mail, Trash2, Save, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useStore } from '@/lib/store';

interface TrialAccount {
  id: string;
  userId: string;
  email: string | null;
  name: string | null;
  plan: string;
  status: string;
  trialEndsAt: string | null;
  daysRemaining: number;
  isExpired: boolean;
  tokensUsed: number;
  tokensLimit: number;
  usagePercentage: number;
  createdAt: string;
  emailVerified: boolean;
}

interface TrialStats {
  total: number;
  active: number;
  expired: number;
  byPlan: {
    plus: number;
    pro: number;
  };
}

interface User {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  isAdmin: boolean;
  isSuperUser: boolean;
  emailVerified: Date | null;
  createdAt: Date;
  subscription: {
    plan: string;
    status: string;
    tokensUsed: number;
    tokensLimit: number;
    tokensRemaining: number;
    usagePercentage: number;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
  } | null;
  usageStats: {
    totalLogs: number;
    totalTokensUsed: number;
    lastActivity: Date | null;
  };
}

interface Stats {
  totalUsers: number;
  totalSubscriptions: number;
  subscriptionsByPlan: {
    free: number;
    plus: number;
    pro: number;
    premium: number;
  };
  totalTokensUsed: number;
  totalTokensLimit: number;
}

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLLMConfig, setShowLLMConfig] = useState(false);
  const { llmConfig, setLLMConfig } = useStore();
  
  // Local LLM config state for editing (Save button pattern)
  // Each provider has its own API key and optional model (providerModels)
  const [localLLMConfig, setLocalLLMConfig] = useState({
    provider: llmConfig.provider,
    apiKeys: llmConfig.apiKeys || {
      openai: llmConfig.provider === 'openai' ? llmConfig.apiKey : '',
      gemini: llmConfig.provider === 'gemini' ? llmConfig.apiKey : '',
      anthropic: llmConfig.provider === 'anthropic' ? llmConfig.apiKey : '',
      deepseek: llmConfig.provider === 'deepseek' ? llmConfig.apiKey : '',
      custom: llmConfig.provider === 'custom' ? llmConfig.apiKey : '',
    },
    baseURL: llmConfig.baseURL,
    model: llmConfig.model,
    providerModels: llmConfig.providerModels ?? {},
  });
  const [llmConfigChanged, setLLMConfigChanged] = useState(false);
  const [llmSaveSuccess, setLLMSaveSuccess] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  
  // Dynamic model fetching
  const [availableModels, setAvailableModels] = useState<{ value: string; label: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  
  // Trial account states
  const [showTrialForm, setShowTrialForm] = useState(false);
  const [trialAccounts, setTrialAccounts] = useState<TrialAccount[]>([]);
  const [trialStats, setTrialStats] = useState<TrialStats | null>(null);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialFormData, setTrialFormData] = useState({
    email: '',
    name: '',
    trialDays: 14,
    plan: 'plus' as 'plus' | 'pro',
  });
  const [trialSuccess, setTrialSuccess] = useState<{ setupPasswordUrl: string; email: string; emailSent: boolean; emailError?: string } | null>(null);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [trialExpiryLoading, setTrialExpiryLoading] = useState(false);
  const [deleteUserLoading, setDeleteUserLoading] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;

    if (!session) {
      router.push('/login');
      return;
    }

    fetchUsers();
    fetchTrialAccounts();
  }, [session, status, router]);

  // Sync local LLM config when opening the panel or when global config changes
  useEffect(() => {
    if (showLLMConfig) {
      setLocalLLMConfig({
        provider: llmConfig.provider,
        apiKeys: llmConfig.apiKeys || {
          openai: llmConfig.provider === 'openai' ? llmConfig.apiKey : '',
          gemini: llmConfig.provider === 'gemini' ? llmConfig.apiKey : '',
          anthropic: llmConfig.provider === 'anthropic' ? llmConfig.apiKey : '',
          deepseek: llmConfig.provider === 'deepseek' ? llmConfig.apiKey : '',
          custom: llmConfig.provider === 'custom' ? llmConfig.apiKey : '',
        },
        baseURL: llmConfig.baseURL,
        model: llmConfig.model,
        providerModels: llmConfig.providerModels ?? {},
      });
      setLLMConfigChanged(false);
      setLLMSaveSuccess(false);
      setShowApiKey(false);
    }
  }, [showLLMConfig, llmConfig.provider, llmConfig.apiKey, llmConfig.apiKeys, llmConfig.baseURL, llmConfig.model, llmConfig.providerModels]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/users');
      
      if (response.status === 403) {
        setError('You do not have permission to access this page. Super User access required.');
        setLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load user data');
      }

      const data = await response.json();
      setUsers(data.users);
      setStats(data.stats);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'An error occurred while loading data');
    } finally {
      setLoading(false);
    }
  };

  const fetchTrialAccounts = async () => {
    try {
      const response = await fetch('/api/admin/trial-accounts');
      if (response.ok) {
        const data = await response.json();
        setTrialAccounts(data.accounts || []);
        setTrialStats(data.stats || null);
      }
    } catch (err) {
      console.error('Failed to fetch trial accounts:', err);
    }
  };

  const handleCreateTrialAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrialLoading(true);
    setTrialError(null);
    setTrialSuccess(null);

    try {
      const response = await fetch('/api/admin/trial-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trialFormData),
      });

      const data = await response.json();

      if (response.ok) {
        setTrialSuccess({
          setupPasswordUrl: data.setupPasswordUrl,
          email: data.user.email,
          emailSent: data.emailSent,
          emailError: data.emailError,
        });
        setTrialFormData({ email: '', name: '', trialDays: 14, plan: 'plus' });
        fetchTrialAccounts();
        fetchUsers();
      } else {
        setTrialError(data.error || 'Failed to create trial account');
      }
    } catch (err) {
      setTrialError('An unexpected error occurred');
    } finally {
      setTrialLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string, email: string | null) => {
    if (!confirm(`確定要刪除用戶 ${email || userId} 嗎？\n\n此操作無法復原，用戶資料將被永久刪除。`)) return;
    setDeleteUserLoading(userId);
    try {
      const response = await fetch(`/api/admin/users?userId=${userId}`, { method: 'DELETE' });
      const data = await response.json();
      if (response.ok) {
        fetchUsers();
        fetchTrialAccounts();
      } else {
        throw new Error(data.error || '刪除失敗');
      }
    } catch (err: any) {
      alert(err.message || '刪除用戶失敗');
    } finally {
      setDeleteUserLoading(null);
    }
  };

  const handleRunTrialExpiry = async () => {
    setTrialExpiryLoading(true);
    try {
      const response = await fetch('/api/admin/run-trial-expiry', { method: 'POST' });
      const data = await response.json();
      if (response.ok && data.processed > 0) {
        alert(`已自動轉換 ${data.processed} 個過期試用帳號為免費方案`);
        fetchTrialAccounts();
        fetchUsers();
      } else if (response.ok) {
        alert('目前沒有需要處理的過期試用帳號');
      } else {
        throw new Error(data.error || '執行失敗');
      }
    } catch (err: any) {
      alert(err.message || '執行試用到期轉換失敗');
    } finally {
      setTrialExpiryLoading(false);
    }
  };

  const handleTrialAction = async (userId: string, action: 'convert' | 'delete' | 'extend') => {
    setActionLoading(userId);
    try {
      if (action === 'extend') {
        const response = await fetch('/api/admin/trial-accounts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, extendDays: 7 }),
        });
        if (!response.ok) throw new Error('Failed to extend trial');
      } else {
        const response = await fetch(`/api/admin/trial-accounts?userId=${userId}&action=${action}`, {
          method: 'DELETE',
        });
        if (!response.ok) throw new Error(`Failed to ${action} trial account`);
      }
      fetchTrialAccounts();
      fetchUsers();
    } catch (err: any) {
      alert(err.message || 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(2) + 'K';
    }
    return num.toString();
  };

  const formatDate = (date: Date | null) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Provider presets for base URLs
  const providerPresets: Record<string, { baseURL: string; defaultModel: string }> = {
    openai: {
      baseURL: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o'
    },
    gemini: {
      baseURL: 'https://generativelanguage.googleapis.com',
      defaultModel: 'gemini-1.5-flash'
    },
    deepseek: {
      baseURL: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat'
    },
    anthropic: {
      baseURL: 'https://api.anthropic.com/v1',
      defaultModel: 'claude-3-5-sonnet-20241022'
    },
    custom: {
      baseURL: 'http://localhost:11434/v1',
      defaultModel: 'llama3'
    },
  };

  // Fetch available models from API
  const fetchAvailableModels = async (provider: string, apiKey: string, baseURL: string) => {
    setModelsLoading(true);
    setModelsError(null);
    
    try {
      const response = await fetch('/api/admin/llm-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, baseURL }),
      });

      const data = await response.json();

      if (response.ok && data.models) {
        setAvailableModels(data.models);
        // If current model is not in the list, set to first available
        if (data.models.length > 0) {
          const currentModelExists = data.models.some((m: any) => m.value === localLLMConfig.model);
          if (!currentModelExists) {
            setLocalLLMConfig(prev => ({ ...prev, model: data.models[0].value }));
            setLLMConfigChanged(true);
          }
        }
      } else {
        setModelsError(data.error || 'Failed to fetch models');
      }
    } catch (error: any) {
      console.error('[Models] Error fetching:', error);
      setModelsError('Failed to connect to API');
    } finally {
      setModelsLoading(false);
    }
  };

  // Fetch models when panel opens or provider changes
  useEffect(() => {
    if (showLLMConfig) {
      const apiKey = localLLMConfig.apiKeys[localLLMConfig.provider as keyof typeof localLLMConfig.apiKeys] || '';
      fetchAvailableModels(localLLMConfig.provider, apiKey, localLLMConfig.baseURL);
    }
  }, [showLLMConfig, localLLMConfig.provider]);

  // Debounced fetch when API key changes
  useEffect(() => {
    if (!showLLMConfig) return;
    
    const currentApiKey = localLLMConfig.apiKeys[localLLMConfig.provider as keyof typeof localLLMConfig.apiKeys] || '';
    
    const timer = setTimeout(() => {
      if (currentApiKey) {
        fetchAvailableModels(localLLMConfig.provider, currentApiKey, localLLMConfig.baseURL);
      }
    }, 500); // Debounce 500ms

    return () => clearTimeout(timer);
  }, [localLLMConfig.apiKeys, localLLMConfig.baseURL, localLLMConfig.provider]);

  const handleProviderChange = (provider: string) => {
    const preset = providerPresets[provider as keyof typeof providerPresets];
    setLocalLLMConfig({
      ...localLLMConfig,
      provider: provider as any,
      baseURL: preset?.baseURL || localLLMConfig.baseURL,
      model: preset?.defaultModel || localLLMConfig.model
    });
    setLLMConfigChanged(true);
    setLLMSaveSuccess(false);
    setShowApiKey(false);
  };

  const handleApiKeyChange = (provider: string, apiKey: string) => {
    setLocalLLMConfig({
      ...localLLMConfig,
      apiKeys: {
        ...localLLMConfig.apiKeys,
        [provider]: apiKey,
      },
    });
    setLLMConfigChanged(true);
    setLLMSaveSuccess(false);
  };

  const handleLocalLLMChange = (updates: Partial<typeof localLLMConfig>) => {
    setLocalLLMConfig({ ...localLLMConfig, ...updates });
    setLLMConfigChanged(true);
    setLLMSaveSuccess(false);
  };

  const handleSaveLLMConfig = () => {
    const currentApiKey = localLLMConfig.apiKeys[localLLMConfig.provider as keyof typeof localLLMConfig.apiKeys] || '';
    // Persist current provider's model into providerModels so default is always stored
    const providerModels = { ...(localLLMConfig.providerModels ?? {}), [localLLMConfig.provider]: localLLMConfig.model };
    setLLMConfig({
      provider: localLLMConfig.provider,
      apiKey: currentApiKey, // Keep for backward compatibility
      apiKeys: localLLMConfig.apiKeys,
      baseURL: localLLMConfig.baseURL,
      model: localLLMConfig.model,
      providerModels,
    });
    setLLMConfigChanged(false);
    setLLMSaveSuccess(true);
    setTimeout(() => setLLMSaveSuccess(false), 3000);
  };

  const handleResetLLMConfig = () => {
    setLocalLLMConfig({
      provider: llmConfig.provider,
      apiKeys: llmConfig.apiKeys || {
        openai: llmConfig.provider === 'openai' ? llmConfig.apiKey : '',
        gemini: llmConfig.provider === 'gemini' ? llmConfig.apiKey : '',
        anthropic: llmConfig.provider === 'anthropic' ? llmConfig.apiKey : '',
        deepseek: llmConfig.provider === 'deepseek' ? llmConfig.apiKey : '',
        custom: llmConfig.provider === 'custom' ? llmConfig.apiKey : '',
      },
      baseURL: llmConfig.baseURL,
      model: llmConfig.model,
      providerModels: llmConfig.providerModels ?? {},
    });
    setLLMConfigChanged(false);
    setLLMSaveSuccess(false);
    setShowApiKey(false);
  };

  const handleRefreshModels = () => {
    const apiKey = localLLMConfig.apiKeys[localLLMConfig.provider as keyof typeof localLLMConfig.apiKeys] || '';
    fetchAvailableModels(localLLMConfig.provider, apiKey, localLLMConfig.baseURL);
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-6 py-8">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Access Denied</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push('/dashboard')}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8 space-y-6">
      {/* Back Link */}
      <div className="mb-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin Console</h1>
          <p className="text-muted-foreground mt-2">
            Super User management panel - View all users and subscription information
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowTrialForm(!showTrialForm)} className="bg-cyan-600 hover:bg-cyan-500 text-white">
            <UserPlus className="w-4 h-4 mr-2" />
            Create Trial Account
          </Button>
          <Button onClick={() => setShowLLMConfig(!showLLMConfig)} variant="outline">
            <Settings className="w-4 h-4 mr-2" />
            LLM Configuration
          </Button>
          <Button onClick={() => { fetchUsers(); fetchTrialAccounts(); }} variant="outline">
            Refresh
          </Button>
        </div>
      </div>

      {/* Create Trial Account Form */}
      {showTrialForm && (
        <Card className="border-cyan-500/30 bg-cyan-500/5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-cyan-500" />
                  Create Trial Account
                </CardTitle>
                <CardDescription>
                  Create a trial account for a new user to test the platform
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowTrialForm(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {trialSuccess ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-cyan-600">
                  <CheckCircle className="w-5 h-5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Trial account created for {trialSuccess.email}</p>
                    {trialSuccess.emailSent ? (
                      <p className="text-sm text-cyan-600/80">✉️ Setup email has been sent to the user</p>
                    ) : (
                      <p className="text-sm text-cyan-600/80">Share the setup link with the user manually</p>
                    )}
                  </div>
                </div>

                {/* Email status message */}
                {trialSuccess.emailSent ? (
                  <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-600">
                    <Mail className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm">Setup email sent successfully! The user can check their inbox.</span>
                  </div>
                ) : trialSuccess.emailError ? (
                  <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-600">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">Email sending failed</p>
                      <p className="text-amber-600/80">{trialSuccess.emailError}</p>
                      <p className="text-amber-600/80 mt-1">Please share the link below manually.</p>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label className="text-sm">Password Setup Link {trialSuccess.emailSent && '(backup)'}</Label>
                  <div className="flex gap-2">
                    <Input 
                      value={trialSuccess.setupPasswordUrl} 
                      readOnly 
                      className="font-mono text-xs"
                    />
                    <Button 
                      variant="outline" 
                      size="icon"
                      onClick={() => copyToClipboard(trialSuccess.setupPasswordUrl)}
                      title="Copy to clipboard"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="outline" 
                      size="icon"
                      onClick={() => window.open(trialSuccess.setupPasswordUrl, '_blank')}
                      title="Open in new tab"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">This link expires in 48 hours</p>
                </div>
                <Button onClick={() => { setTrialSuccess(null); setShowTrialForm(false); }} className="w-full">
                  Done
                </Button>
              </div>
            ) : (
              <form onSubmit={handleCreateTrialAccount} className="space-y-4">
                {trialError && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{trialError}</span>
                  </div>
                )}
                
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="trial-email">Email *</Label>
                    <Input
                      id="trial-email"
                      type="email"
                      placeholder="user@example.com"
                      value={trialFormData.email}
                      onChange={(e) => setTrialFormData({ ...trialFormData, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="trial-name">Name (optional)</Label>
                    <Input
                      id="trial-name"
                      type="text"
                      placeholder="User Name"
                      value={trialFormData.name}
                      onChange={(e) => setTrialFormData({ ...trialFormData, name: e.target.value })}
                    />
                  </div>
                </div>
                
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="trial-days">Trial Period (days) *</Label>
                    <Input
                      id="trial-days"
                      type="number"
                      min={1}
                      max={30}
                      value={trialFormData.trialDays}
                      onChange={(e) => setTrialFormData({ ...trialFormData, trialDays: parseInt(e.target.value) || 14 })}
                      required
                    />
                    <p className="text-xs text-muted-foreground">1-30 days</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="trial-plan">Trial Plan *</Label>
                    <select
                      id="trial-plan"
                      value={trialFormData.plan}
                      onChange={(e) => setTrialFormData({ ...trialFormData, plan: e.target.value as 'plus' | 'pro' })}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="plus">Plus (500K tokens/month)</option>
                      <option value="pro">Pro (2M tokens/month)</option>
                    </select>
                  </div>
                </div>
                
                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={trialLoading} className="bg-cyan-600 hover:bg-cyan-500">
                    {trialLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4 mr-2" />
                        Create Trial Account
                      </>
                    )}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowTrialForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* Trial Accounts Section */}
      {trialAccounts.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-cyan-500" />
                  Trial Accounts
                </CardTitle>
                <CardDescription>
                  {trialStats && (
                    <span>
                      {trialStats.active} active, {trialStats.expired} expired
                      {' '}({trialStats.byPlan.plus} Plus, {trialStats.byPlan.pro} Pro)
                      {' · '}過期試用每日 0:00 UTC 自動轉免費，或
                    </span>
                  )}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRunTrialExpiry}
                disabled={trialExpiryLoading}
                title="立即將過期試用帳號轉為免費方案"
              >
                {trialExpiryLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '立即轉換過期試用'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">User</th>
                    <th className="text-left p-2">Plan</th>
                    <th className="text-left p-2">Trial Ends</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Usage</th>
                    <th className="text-left p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {trialAccounts.map((account) => (
                    <tr key={account.id} className="border-b hover:bg-muted/50">
                      <td className="p-2">
                        <div>
                          <div className="font-medium">{account.name || 'N/A'}</div>
                          <div className="text-xs text-muted-foreground">{account.email}</div>
                        </div>
                      </td>
                      <td className="p-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          account.plan === 'pro' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {account.plan.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-2">
                        <div>
                          <div className={`font-medium ${account.isExpired ? 'text-red-500' : ''}`}>
                            {account.trialEndsAt ? new Date(account.trialEndsAt).toLocaleDateString() : 'N/A'}
                          </div>
                          <div className={`text-xs ${
                            account.isExpired ? 'text-red-500' : 
                            account.daysRemaining <= 3 ? 'text-amber-500' : 'text-muted-foreground'
                          }`}>
                            {account.isExpired ? 'Expired' : `${account.daysRemaining} days left`}
                          </div>
                        </div>
                      </td>
                      <td className="p-2">
                        <span className={`px-2 py-1 rounded text-xs ${
                          account.isExpired ? 'bg-red-100 text-red-800' :
                          account.status === 'trialing' ? 'bg-cyan-100 text-cyan-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {account.isExpired ? 'Expired' : account.status}
                        </span>
                      </td>
                      <td className="p-2">
                        <div className="w-20">
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full ${
                                account.usagePercentage >= 90 ? 'bg-red-500' :
                                account.usagePercentage >= 70 ? 'bg-amber-500' :
                                'bg-cyan-500'
                              }`}
                              style={{ width: `${Math.min(account.usagePercentage, 100)}%` }}
                            />
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {account.usagePercentage.toFixed(0)}%
                          </div>
                        </div>
                      </td>
                      <td className="p-2">
                        {/* 已升級為付費方案 (active) 的用戶不顯示試用操作按鈕 */}
                        {!(account.status === 'active' && ['premium', 'plus', 'pro'].includes(account.plan)) && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleTrialAction(account.userId, 'extend')}
                              disabled={actionLoading === account.userId}
                              title="Extend 7 days"
                            >
                              {actionLoading === account.userId ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                '+7d'
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleTrialAction(account.userId, 'convert')}
                              disabled={actionLoading === account.userId}
                              title="Convert to Free"
                            >
                              Free
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                              onClick={() => {
                                if (confirm(`確定要刪除試用帳號 ${account.email} 嗎？\n\n此操作無法復原，帳號資料將被永久刪除。`)) {
                                  handleTrialAction(account.userId, 'delete');
                                }
                              }}
                              disabled={actionLoading === account.userId}
                              title="Delete account"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* LLM Configuration Panel */}
      {showLLMConfig && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>LLM Configuration</CardTitle>
                <CardDescription>
                  Configure AI provider settings for the platform
                </CardDescription>
              </div>
              {llmConfigChanged && (
                <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
                  Unsaved changes
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Success message */}
            {llmSaveSuccess && (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-600">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm">Configuration saved successfully!</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="admin-provider" className="text-sm font-medium">AI Provider</Label>
              <select
                id="admin-provider"
                value={localLLMConfig.provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <option value="openai">OpenAI {llmConfig.provider === 'openai' ? '(default)' : ''}</option>
                <option value="gemini">Google Gemini {llmConfig.provider === 'gemini' ? '(default)' : ''}</option>
                <option value="deepseek">DeepSeek {llmConfig.provider === 'deepseek' ? '(default)' : ''}</option>
                <option value="anthropic">Anthropic (Claude) {llmConfig.provider === 'anthropic' ? '(default)' : ''}</option>
                <option value="custom">Custom / Ollama {llmConfig.provider === 'custom' ? '(default)' : ''}</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-api-key" className="text-sm font-medium">
                API Key for {localLLMConfig.provider === 'openai' ? 'OpenAI' : 
                             localLLMConfig.provider === 'gemini' ? 'Gemini' : 
                             localLLMConfig.provider === 'anthropic' ? 'Anthropic' : 
                             localLLMConfig.provider === 'deepseek' ? 'DeepSeek' : 'Custom'}
              </Label>
              <div className="relative">
                <Input
                  id="admin-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  className="font-mono text-sm pr-10"
                  value={localLLMConfig.apiKeys[localLLMConfig.provider as keyof typeof localLLMConfig.apiKeys] || ''}
                  onChange={(e) => handleApiKeyChange(localLLMConfig.provider, e.target.value)}
                  placeholder={
                    localLLMConfig.provider === 'gemini'
                      ? 'AIza...'
                      : localLLMConfig.provider === 'openai'
                      ? 'sk-...'
                      : localLLMConfig.provider === 'anthropic'
                      ? 'sk-ant-...'
                      : localLLMConfig.provider === 'deepseek'
                      ? 'sk-...'
                      : 'Your API Key'
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => setShowApiKey(!showApiKey)}
                  title={showApiKey ? 'Hide API Key' : 'Show API Key'}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {localLLMConfig.provider === 'gemini' && (
                  <>Get Gemini API Key: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google AI Studio</a></>
                )}
                {localLLMConfig.provider === 'openai' && (
                  <>Get OpenAI API Key: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">OpenAI Platform</a></>
                )}
                {localLLMConfig.provider === 'deepseek' && (
                  <>Get DeepSeek API Key: <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">DeepSeek Platform</a></>
                )}
                {localLLMConfig.provider === 'anthropic' && (
                  <>Get Anthropic API Key: <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Anthropic Console</a></>
                )}
                {localLLMConfig.provider === 'custom' && 'Your key is stored locally in the browser.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="admin-base-url" className="text-sm font-medium">Base URL</Label>
                <Input
                  id="admin-base-url"
                  className="font-mono text-xs"
                  value={localLLMConfig.baseURL}
                  onChange={(e) => handleLocalLLMChange({ baseURL: e.target.value })}
                  placeholder="https://api..."
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="admin-model" className="text-sm font-medium">Model</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRefreshModels}
                    disabled={modelsLoading}
                    className="h-6 px-2 text-xs"
                    title="Refresh models from API"
                  >
                    <RefreshCw className={`w-3 h-3 mr-1 ${modelsLoading ? 'animate-spin' : ''}`} />
                    {modelsLoading ? 'Loading...' : 'Refresh'}
                  </Button>
                </div>
                <select
                  id="admin-model"
                  value={localLLMConfig.model}
                  onChange={(e) => handleLocalLLMChange({ model: e.target.value })}
                  disabled={modelsLoading}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 font-mono text-xs disabled:opacity-50"
                >
                  {availableModels.length > 0 ? (
                    availableModels.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))
                  ) : (
                    <option value={localLLMConfig.model}>{localLLMConfig.model}</option>
                  )}
                </select>
                {modelsError && (
                  <p className="text-xs text-amber-500 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {modelsError} - using fallback list
                  </p>
                )}
                {!localLLMConfig.apiKeys[localLLMConfig.provider as keyof typeof localLLMConfig.apiKeys] && localLLMConfig.provider !== 'anthropic' && (
                  <p className="text-xs text-muted-foreground">
                    Enter API key to fetch latest available models
                  </p>
                )}
              </div>
            </div>

            {/* Per-provider models (used when multiple API keys are used in parallel) */}
            <div className="space-y-2 pt-2 border-t border-border">
              <Label className="text-sm font-medium">Models for other providers</Label>
              <p className="text-xs text-muted-foreground">
                Model name for each provider when multiple API keys are used in parallel (e.g. Lecture Rehearsal). Leave blank to use built-in defaults.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['openai', 'gemini', 'deepseek', 'anthropic', 'custom'] as const).map((p) => {
                  const label = p === 'openai' ? 'OpenAI' : p === 'gemini' ? 'Gemini' : p === 'deepseek' ? 'DeepSeek' : p === 'anthropic' ? 'Anthropic' : 'Custom';
                  const value = (localLLMConfig.providerModels ?? {})[p] ?? (p === localLLMConfig.provider ? localLLMConfig.model : '');
                  return (
                    <div key={p} className="space-y-1">
                      <Label htmlFor={`admin-model-${p}`} className="text-xs text-muted-foreground">{label}</Label>
                      <Input
                        id={`admin-model-${p}`}
                        className="font-mono text-xs h-9"
                        value={value}
                        onChange={(e) => {
                          const next = { ...(localLLMConfig.providerModels ?? {}), [p]: e.target.value };
                          setLocalLLMConfig({ ...localLLMConfig, providerModels: next });
                          setLLMConfigChanged(true);
                          setLLMSaveSuccess(false);
                        }}
                        placeholder={p === 'openai' ? 'gpt-4o' : p === 'gemini' ? 'gemini-1.5-flash' : p === 'deepseek' ? 'deepseek-chat' : p === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'model name'}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Save and Reset buttons */}
            <div className="flex gap-2 pt-2 border-t border-border">
              <Button
                onClick={handleSaveLLMConfig}
                disabled={!llmConfigChanged}
                className="flex-1"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Configuration
              </Button>
              <Button
                onClick={handleResetLLMConfig}
                variant="outline"
                disabled={!llmConfigChanged}
              >
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalUsers}</div>
              <p className="text-xs text-muted-foreground">
                {stats.totalSubscriptions} active subscriptions
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Token Usage</CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNumber(stats.totalTokensUsed)}</div>
              <p className="text-xs text-muted-foreground">
                Total limit: {formatNumber(stats.totalTokensLimit)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Subscription Plans</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Premium:</span>
                  <span className="font-medium">{stats.subscriptionsByPlan.premium}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Pro:</span>
                  <span className="font-medium">{stats.subscriptionsByPlan.pro}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Plus:</span>
                  <span className="font-medium">{stats.subscriptionsByPlan.plus}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Free:</span>
                  <span className="font-medium">{stats.subscriptionsByPlan.free}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Super Users</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {users.filter(u => u.isSuperUser).length}
              </div>
              <p className="text-xs text-muted-foreground">
                {users.filter(u => u.isAdmin).length} administrators
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* User List */}
      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>
            Total {users.length} users
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">User</th>
                  <th className="text-left p-2">Plan</th>
                  <th className="text-left p-2">Token Usage</th>
                  <th className="text-left p-2">Usage</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Registered</th>
                  <th className="text-left p-2">Permissions</th>
                  <th className="text-left p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b hover:bg-muted/50">
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        {user.image && (
                          <img
                            src={user.image}
                            alt={user.name || ''}
                            className="w-6 h-6 rounded-full"
                          />
                        )}
                        <div>
                          <div className="font-medium">{user.name || 'N/A'}</div>
                          <div className="text-xs text-muted-foreground">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-2">
                      {user.subscription ? (
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          user.subscription.plan === 'premium' ? 'bg-purple-100 text-purple-800' :
                          user.subscription.plan === 'pro' ? 'bg-blue-100 text-blue-800' :
                          user.subscription.plan === 'plus' ? 'bg-green-100 text-green-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {user.subscription.plan.toUpperCase()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No Subscription</span>
                      )}
                    </td>
                    <td className="p-2">
                      {user.subscription ? (
                        <div>
                          <div className="font-medium">
                            {formatNumber(user.subscription.tokensUsed)} / {formatNumber(user.subscription.tokensLimit)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Remaining: {formatNumber(user.subscription.tokensRemaining)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </td>
                    <td className="p-2">
                      {user.subscription ? (
                        <div className="w-24">
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full ${
                                user.subscription.usagePercentage >= 90 ? 'bg-destructive' :
                                user.subscription.usagePercentage >= 70 ? 'bg-yellow-500' :
                                'bg-primary'
                              }`}
                              style={{ width: `${Math.min(user.subscription.usagePercentage, 100)}%` }}
                            />
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {user.subscription.usagePercentage.toFixed(1)}%
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </td>
                    <td className="p-2">
                      {user.subscription ? (
                        <span className={`px-2 py-1 rounded text-xs ${
                          user.subscription.status === 'active' ? 'bg-green-100 text-green-800' :
                          user.subscription.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {user.subscription.status}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="p-2">
                      <div className="flex gap-1">
                        {user.isSuperUser && (
                          <span className="px-2 py-1 rounded text-xs bg-purple-100 text-purple-800">
                            Super
                          </span>
                        )}
                        {user.isAdmin && (
                          <span className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-800">
                            Admin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-2">
                      {user.id !== session?.user?.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                          onClick={() => handleDeleteUser(user.id, user.email)}
                          disabled={deleteUserLoading === user.id}
                          title="刪除用戶"
                        >
                          {deleteUserLoading === user.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
