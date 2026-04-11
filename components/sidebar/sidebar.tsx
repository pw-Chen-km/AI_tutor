'use client';

import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen, FlaskConical, FileText, GraduationCap, Mic, Settings, X, Sliders, ClipboardCheck, LogOut, CreditCard, User, Shield, History } from 'lucide-react';
import Image from 'next/image';
import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ALL_QUESTION_TYPES } from '@/lib/subjects';
import { UsageDisplay } from './usage-display';
import { TrialBadge } from '@/components/shared/trial-expiry-modal';
import { GenerationHistoryPanel } from '@/components/generation-history/generation-history-panel';
import { PLAN_CONFIG, type PlanType } from '@/lib/db/schema';

export function Sidebar() {
    const { activeModule, setActiveModule, llmConfig, setLLMConfig, languageConfig, setLanguageConfig, customQuestionTypes, toggleCustomQuestionType } = useStore();
    const { data: session, update: updateSession } = useSession();
    const router = useRouter();
    const [showSettings, setShowSettings] = useState(false);
    const [showCustomize, setShowCustomize] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [userPlan, setUserPlan] = useState<PlanType>('free');

    // Fetch user's plan
    useEffect(() => {
        if (session?.user?.id) {
            fetch('/api/subscription')
                .then(res => res.json())
                .then(data => {
                    if (data?.plan) {
                        setUserPlan(data.plan as PlanType);
                    }
                })
                .catch(err => console.error('Failed to fetch subscription:', err));
        }
    }, [session?.user?.id]);

    const modules = [
        { id: 'lecture_rehearsal' as const, name: 'Lecture Rehearsal', icon: Mic, description: 'Practice presentations' },
        { id: 'drills' as const, name: 'In-Class Drills', icon: BookOpen, description: 'Quick practice questions' },
        { id: 'labs' as const, name: 'Lab Practices', icon: FlaskConical, description: 'Hands-on exercises' },
        { id: 'homework' as const, name: 'Homework', icon: FileText, description: 'Take-home assignments' },
        { id: 'exams' as const, name: 'Exam Generator', icon: GraduationCap, description: 'Assessment creation' },
        { id: 'exam_evaluation' as const, name: 'Exam Evaluation', icon: ClipboardCheck, description: 'Grade student answers' },
    ];

    // Check if a module is available for current plan
    const isModuleAvailable = (moduleId: string): boolean => {
        return PLAN_CONFIG[userPlan].features.modules.includes(moduleId as any);
    };

    // Get plans that have access to a module
    const getModulePlans = (moduleId: string): PlanType[] => {
        const plans: PlanType[] = [];
        (['free', 'plus', 'pro', 'premium'] as PlanType[]).forEach(plan => {
            if (PLAN_CONFIG[plan].features.modules.includes(moduleId as any)) {
                plans.push(plan);
            }
        });
        return plans;
    };

    // Get display label for module availability
    const getModulePlanLabel = (moduleId: string): string => {
        const plans = getModulePlans(moduleId);
        if (plans.length === 0) return '';
        if (plans.length === 4) return ''; // Available in all plans
        
        const planNames = plans.map(plan => {
            switch (plan) {
                case 'free': return 'Free';
                case 'plus': return 'Plus';
                case 'pro': return 'Pro';
                case 'premium': return 'Premium';
                default: return plan;
            }
        });
        return `(${planNames.join('/')})`;
    };

    // If current active module is not available, switch to first available module
    useEffect(() => {
        if (activeModule && !isModuleAvailable(activeModule)) {
            const firstAvailable = modules.find(m => PLAN_CONFIG[userPlan].features.modules.includes(m.id as any));
            if (firstAvailable) {
                setActiveModule(firstAvailable.id);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userPlan, activeModule, setActiveModule]);

    const handleProviderChange = (provider: string) => {
        const presets: Record<string, { baseURL: string; model: string }> = {
            openai: {
                baseURL: 'https://api.openai.com/v1',
                model: 'gpt-4'
            },
            gemini: {
                baseURL: 'https://generativelanguage.googleapis.com',
                model: 'gemini-1.5-flash'
            },
            deepseek: {
                baseURL: 'https://api.deepseek.com/v1',
                model: 'deepseek-chat'
            },
            anthropic: {
                baseURL: 'https://api.anthropic.com/v1',
                model: 'claude-3-sonnet'
            },
            custom: {
                baseURL: 'http://localhost:11434/v1',
                model: 'llama2'
            },
        };

        const preset = presets[provider as keyof typeof presets];
        setLLMConfig({
            provider: provider as any,
            baseURL: preset?.baseURL || llmConfig.baseURL,
            model: preset?.model || llmConfig.model
        });
    };

    return (
        <>
            <div className="w-72 bg-card border-r border-border flex flex-col shadow-soft">
                {/* Header */}
                <div className="p-6 border-b border-border">
                    <div className="flex items-center gap-3">
                        <Image 
                            src="/logo.png" 
                            alt="AsKura Logo" 
                            width={44} 
                            height={44} 
                            className="w-11 h-11"
                        />
                        <div>
                            <h1 className="text-lg font-display font-bold text-foreground tracking-tight">
                                AsKura
                            </h1>
                            <p className="text-xs text-muted-foreground font-medium">
                                Your Educational Tutor
                            </p>
                        </div>
                    </div>
                </div>

                {/* Question Type Configuration */}
                <div className="px-5 py-4 border-b border-border bg-muted/30">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Question Types
                            </p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                                Customized
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-9 px-3 gap-2"
                            onClick={() => setShowCustomize(true)}
                            title="Configure question types"
                        >
                            <Sliders className="w-4 h-4" />
                            <span className="text-xs">Configure</span>
                        </Button>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
                    <p className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Modules
                    </p>

                    {modules.map((module, index) => {
                        const Icon = module.icon;
                        const isActive = activeModule === module.id;
                        const isEnabled = isModuleAvailable(module.id);
                        
                        return (
                            <button
                                key={module.id}
                                onClick={() => isEnabled && setActiveModule(module.id)}
                                disabled={!isEnabled}
                                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group animate-fade-in ${
                                    !isEnabled
                                        ? 'opacity-50 cursor-not-allowed text-muted-foreground'
                                        : isActive
                                        ? 'bg-primary text-primary-foreground shadow-md cursor-pointer'
                                        : 'hover:bg-muted text-foreground cursor-pointer'
                                }`}
                                style={{ animationDelay: `${index * 0.05}s` }}
                                title={!isEnabled ? `This module is not available in your ${userPlan} plan. Upgrade to access.` : undefined}
                            >
                                <div className={`p-2 rounded-lg transition-colors ${
                                    isActive
                                        ? 'bg-primary-foreground/20'
                                        : isEnabled
                                        ? 'bg-muted group-hover:bg-background'
                                        : 'bg-muted/50'
                                }`}>
                                    <Icon className={`w-4 h-4 ${
                                        isActive 
                                            ? 'text-primary-foreground' 
                                            : isEnabled
                                            ? 'text-muted-foreground group-hover:text-foreground'
                                            : 'text-muted-foreground/50'
                                    }`} />
                                </div>
                                <div className="flex-1 text-left">
                                    <span className={`font-medium text-sm block ${
                                        isActive 
                                            ? 'text-primary-foreground' 
                                            : !isEnabled
                                            ? 'text-muted-foreground/50'
                                            : ''
                                    }`}>
                                        {module.name}
                                        {!isEnabled && (
                                            <span className="ml-2 text-xs text-muted-foreground/70">{getModulePlanLabel(module.id)}</span>
                                        )}
                                    </span>
                                    <span className={`text-xs ${
                                        isActive 
                                            ? 'text-primary-foreground/70' 
                                            : !isEnabled
                                            ? 'text-muted-foreground/50'
                                            : 'text-muted-foreground'
                                    }`}>
                                        {module.description}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                    
                    {/* Admin Link - Only for Super Users or Admins */}
                    {(session?.user?.isSuperUser || session?.user?.isAdmin) && (
                        <div className="mt-4 pt-4 border-t border-border">
                            <p className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Admin
                            </p>
                            <Link
                                href="/admin"
                                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 hover:bg-muted text-foreground group cursor-pointer"
                            >
                                <div className="p-2 rounded-lg bg-muted group-hover:bg-background transition-colors">
                                    <Shield className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
                                </div>
                                <div className="flex-1 text-left">
                                    <span className="font-medium text-sm block">Admin Console</span>
                                    <span className="text-xs text-muted-foreground">Manage users & subscriptions</span>
                                </div>
                            </Link>
                        </div>
                    )}
                </nav>

                {/* Usage Display */}
                <div className="px-4 py-3 border-t border-border">
                    <UsageDisplay />
                </div>

                {/* Trial Badge (shows only for trial accounts) */}
                <div className="px-4 pb-2">
                    <TrialBadge />
                </div>

                {/* Footer / Settings */}
                <div className="p-4 border-t border-border space-y-2">
                    <Button
                        variant="ghost"
                        className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl h-11 transition-colors duration-200 cursor-pointer"
                        onClick={() => setShowHistory(true)}
                    >
                        <History className="w-4 h-4 mr-3" />
                        <span className="font-medium">Generation History</span>
                    </Button>
                    <Button
                        variant="ghost"
                        className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl h-11 transition-colors duration-200 cursor-pointer"
                        onClick={() => setShowSettings(true)}
                    >
                        <Settings className="w-4 h-4 mr-3" />
                        <span className="font-medium">Settings</span>
                    </Button>
                    
                    {/* User Section */}
                    {session?.user && (
                        <div className="relative">
                            <button
                                onClick={() => setShowUserMenu(!showUserMenu)}
                                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted transition-colors duration-200 cursor-pointer"
                            >
                                {session.user.image ? (
                                    <img
                                        src={session.user.image}
                                        alt={session.user.name || 'User'}
                                        className="w-8 h-8 rounded-full"
                                    />
                                ) : (
                                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                                        <User className="w-4 h-4 text-primary" />
                                    </div>
                                )}
                                <div className="flex-1 text-left">
                                    <p className="text-sm font-medium text-foreground truncate">
                                        {session.user.name || 'User'}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate">
                                        {session.user.email}
                                    </p>
                                </div>
                            </button>
                            
                            {showUserMenu && (
                                <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50">
                                    <Link
                                        href="/billing"
                                        className="flex items-center gap-2 px-4 py-3 hover:bg-muted transition-colors duration-200 cursor-pointer"
                                        onClick={() => setShowUserMenu(false)}
                                    >
                                        <CreditCard className="w-4 h-4 text-muted-foreground" />
                                        <span className="text-sm">Subscription</span>
                                    </Link>
                                    <button
                                        onClick={() => signOut({ callbackUrl: '/login' })}
                                        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted transition-colors duration-200 text-red-500 cursor-pointer"
                                    >
                                        <LogOut className="w-4 h-4" />
                                        <span className="text-sm">Sign Out</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Settings Modal */}
            {showSettings && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 backdrop-blur-sm animate-fade-in">
                    <div className="relative w-full max-w-md mx-4 animate-scale-in">
                        <Card className="shadow-elevated border-border overflow-hidden">
                            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4 border-b border-border bg-muted/30">
                                <div className="space-y-1">
                                    <CardTitle className="text-xl font-display">Settings</CardTitle>
                                    <CardDescription>Configure your language preferences</CardDescription>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 -mt-1 text-muted-foreground hover:text-foreground rounded-lg"
                                    onClick={() => setShowSettings(false)}
                                >
                                    <X className="w-5 h-5" />
                                </Button>
                            </CardHeader>
                            <CardContent className="pt-6 space-y-5">
                                <div className="space-y-2">
                                    <CardTitle className="text-base font-display">Language Settings</CardTitle>
                                    <CardDescription>
                                        Configure primary and secondary languages for generated content
                                    </CardDescription>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="primary-language" className="text-sm font-medium">Primary Language</Label>
                                        <select
                                            id="primary-language"
                                            value={languageConfig.primaryLanguage}
                                            onChange={(e) => setLanguageConfig({ primaryLanguage: e.target.value })}
                                            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                        >
                                            <option value="English">English</option>
                                            <option value="繁體中文">繁體中文</option>
                                            <option value="简体中文">简体中文</option>
                                            <option value="日本語">日本語</option>
                                            <option value="한국어">한국어</option>
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="secondary-language" className="text-sm font-medium">Secondary Language</Label>
                                        <select
                                            id="secondary-language"
                                            value={languageConfig.secondaryLanguage}
                                            onChange={(e) => setLanguageConfig({ secondaryLanguage: e.target.value })}
                                            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                        >
                                            <option value="繁體中文">繁體中文</option>
                                            <option value="English">English</option>
                                            <option value="简体中文">简体中文</option>
                                            <option value="日本語">日本語</option>
                                            <option value="한국어">한국어</option>
                                            <option value="none">None</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="pt-4 flex justify-end">
                                    <Button onClick={() => setShowSettings(false)} className="px-8 rounded-xl">
                                        Done
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}

            {/* Customize Question Types Modal */}
            {showCustomize && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 backdrop-blur-sm animate-fade-in">
                    <div className="relative w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto animate-scale-in">
                        <Card className="shadow-elevated border-border overflow-hidden">
                            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4 border-b border-border bg-muted/30">
                                <div className="space-y-1">
                                    <CardTitle className="text-xl font-display">Question Type Configuration</CardTitle>
                                    <CardDescription>Select which question types to use in each module</CardDescription>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 -mt-1 text-muted-foreground hover:text-foreground rounded-lg"
                                    onClick={() => setShowCustomize(false)}
                                >
                                    <X className="w-5 h-5" />
                                </Button>
                            </CardHeader>
                            <CardContent className="pt-6 space-y-6">
                                {/* In-Class Drills */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <BookOpen className="w-4 h-4 text-primary" />
                                        <Label className="text-sm font-semibold">In-Class Drills</Label>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {ALL_QUESTION_TYPES.map((type) => (
                                            <label
                                                key={`drills-${type.id}`}
                                                className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                                                    customQuestionTypes.drills.includes(type.id)
                                                        ? 'bg-primary/10 border-primary'
                                                        : 'border-border hover:bg-muted/50'
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={customQuestionTypes.drills.includes(type.id)}
                                                    onChange={() => toggleCustomQuestionType('drills', type.id)}
                                                    className="sr-only"
                                                />
                                                <span className={`text-xs ${customQuestionTypes.drills.includes(type.id) ? 'font-medium' : ''}`}>
                                                    {type.label}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {/* Lab Practices */}
                                <div className="space-y-3 pt-3 border-t border-border">
                                    <div className="flex items-center gap-2">
                                        <FlaskConical className="w-4 h-4 text-primary" />
                                        <Label className="text-sm font-semibold">Lab Practices</Label>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {ALL_QUESTION_TYPES.map((type) => (
                                            <label
                                                key={`labs-${type.id}`}
                                                className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                                                    customQuestionTypes.labs.includes(type.id)
                                                        ? 'bg-primary/10 border-primary'
                                                        : 'border-border hover:bg-muted/50'
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={customQuestionTypes.labs.includes(type.id)}
                                                    onChange={() => toggleCustomQuestionType('labs', type.id)}
                                                    className="sr-only"
                                                />
                                                <span className={`text-xs ${customQuestionTypes.labs.includes(type.id) ? 'font-medium' : ''}`}>
                                                    {type.label}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {/* Homework */}
                                <div className="space-y-3 pt-3 border-t border-border">
                                    <div className="flex items-center gap-2">
                                        <FileText className="w-4 h-4 text-primary" />
                                        <Label className="text-sm font-semibold">Homework</Label>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {ALL_QUESTION_TYPES.map((type) => (
                                            <label
                                                key={`homework-${type.id}`}
                                                className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                                                    customQuestionTypes.homework.includes(type.id)
                                                        ? 'bg-primary/10 border-primary'
                                                        : 'border-border hover:bg-muted/50'
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={customQuestionTypes.homework.includes(type.id)}
                                                    onChange={() => toggleCustomQuestionType('homework', type.id)}
                                                    className="sr-only"
                                                />
                                                <span className={`text-xs ${customQuestionTypes.homework.includes(type.id) ? 'font-medium' : ''}`}>
                                                    {type.label}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {/* Exam Generator */}
                                <div className="space-y-3 pt-3 border-t border-border">
                                    <div className="flex items-center gap-2">
                                        <GraduationCap className="w-4 h-4 text-primary" />
                                        <Label className="text-sm font-semibold">Exam Generator</Label>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {ALL_QUESTION_TYPES.map((type) => (
                                            <label
                                                key={`exams-${type.id}`}
                                                className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                                                    customQuestionTypes.exams.includes(type.id)
                                                        ? 'bg-primary/10 border-primary'
                                                        : 'border-border hover:bg-muted/50'
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={customQuestionTypes.exams.includes(type.id)}
                                                    onChange={() => toggleCustomQuestionType('exams', type.id)}
                                                    className="sr-only"
                                                />
                                                <span className={`text-xs ${customQuestionTypes.exams.includes(type.id) ? 'font-medium' : ''}`}>
                                                    {type.label}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className="pt-4 flex justify-end">
                                    <Button onClick={() => setShowCustomize(false)} className="px-8 rounded-xl">
                                        Done
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}

            {/* Generation History Modal */}
            {showHistory && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 backdrop-blur-sm animate-fade-in">
                    <div className="relative w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto animate-scale-in">
                        <GenerationHistoryPanel onClose={() => setShowHistory(false)} />
                    </div>
                </div>
            )}
        </>
    );
}
