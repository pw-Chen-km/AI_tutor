import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowRight, Check, PenTool, GraduationCap, ClipboardCheck, Zap, Shield, Globe } from 'lucide-react';
import { PricingPlans } from '@/components/pricing-plans';

export default async function Home() {
    const session = await getServerSession(authOptions);
    
    // If logged in, redirect to dashboard
    if (session) {
        redirect('/dashboard');
    }
    
    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
            {/* Subtle background decoration */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-blue-100/40 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
                <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-sky-100/40 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3" />
            </div>
            
            {/* Navigation - Floating style */}
            <nav className="relative z-10 mx-auto max-w-7xl px-6 pt-6">
                <div className="flex items-center justify-between rounded-2xl bg-white/80 backdrop-blur-md border border-slate-200/60 px-6 py-4 shadow-sm">
                    <Link href="/" className="flex items-center gap-3 cursor-pointer group">
                        <Image 
                            src="/logo.png" 
                            alt="AsKura Logo" 
                            width={140} 
                            height={40} 
                            className="h-10 w-auto transition-transform duration-200 group-hover:scale-105"
                            priority
                        />
                        <span className="text-xl font-bold text-slate-800">AsKura</span>
                    </Link>
                    <div className="flex items-center gap-3">
                        <Link href="/login">
                            <Button variant="ghost" className="text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors duration-200 cursor-pointer">
                                Sign In
                            </Button>
                        </Link>
                        <Link href="/register">
                            <Button className="bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-200 cursor-pointer shadow-md shadow-blue-600/20 hover:shadow-lg hover:shadow-blue-600/30">
                                Get Started Free
                            </Button>
                        </Link>
                    </div>
                </div>
            </nav>
            
            {/* Hero Section */}
            <main className="relative z-10 max-w-7xl mx-auto px-6 pt-20 pb-12">
                <div className="text-center space-y-8 max-w-4xl mx-auto">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-full text-blue-700 text-sm font-medium">
                        <Sparkles className="w-4 h-4" />
                        Your Educational AI Tutor
                    </div>
                    
                    <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-slate-900 leading-tight tracking-tight">
                        Generate Educational
                        <br />
                        Content{' '}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-sky-500">
                            in Seconds
                        </span>
                    </h1>
                    
                    <p className="text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
                        Create exercises, assignments, exams, and automatically evaluate student submissions. 
                        Upload your course materials and let AI handle the content creation and grading.
                    </p>
                    
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
                        <Link href="/register">
                            <Button size="lg" className="h-14 px-8 bg-blue-600 hover:bg-blue-700 text-lg font-medium shadow-lg shadow-blue-600/25 transition-all duration-200 hover:shadow-xl hover:shadow-blue-600/30 hover:-translate-y-0.5 cursor-pointer">
                                Start Free Trial
                                <ArrowRight className="w-5 h-5 ml-2" />
                            </Button>
                        </Link>
                        <Link href="/login">
                            <Button size="lg" variant="outline" className="h-14 px-8 border-2 border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400 text-lg transition-colors duration-200 cursor-pointer">
                                Sign In
                            </Button>
                        </Link>
                    </div>
                </div>
                
                {/* Trust indicators */}
                <div className="flex flex-wrap items-center justify-center gap-8 mt-16 text-slate-500 text-sm">
                    <div className="flex items-center gap-2">
                        <Shield className="w-5 h-5 text-green-600" />
                        <span>Enterprise-grade Security</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Zap className="w-5 h-5 text-amber-500" />
                        <span>Powered by Advanced AI</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Globe className="w-5 h-5 text-blue-600" />
                        <span>Multi-language Support</span>
                    </div>
                </div>
                
                {/* Features Grid */}
                <div className="grid md:grid-cols-3 gap-6 mt-24">
                    {/* Exercise Generator */}
                    <div className="group bg-white rounded-2xl p-8 space-y-4 border border-slate-200 hover:border-blue-300 hover:shadow-xl hover:shadow-blue-100/50 transition-all duration-300 cursor-pointer">
                        <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                            <PenTool className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-semibold text-slate-900">Exercise Generator</h3>
                        <p className="text-slate-600 leading-relaxed">
                            Create quick in-class drills and hands-on lab practices with step-by-step instructions. 
                            Perfect for interactive learning and immediate student engagement.
                        </p>
                    </div>
                    
                    {/* Assignment & Exam Generator */}
                    <div className="group bg-white rounded-2xl p-8 space-y-4 border border-slate-200 hover:border-sky-300 hover:shadow-xl hover:shadow-sky-100/50 transition-all duration-300 cursor-pointer">
                        <div className="w-14 h-14 bg-gradient-to-br from-sky-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/30 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                            <GraduationCap className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-semibold text-slate-900">Assignment & Exam Generator</h3>
                        <p className="text-slate-600 leading-relaxed">
                            Generate comprehensive homework assignments and formal exams with multiple question types, 
                            answer keys, and detailed explanations. Perfect for assessments and take-home work.
                        </p>
                    </div>
                    
                    {/* Exam Evaluation */}
                    <div className="group bg-white rounded-2xl p-8 space-y-4 border border-slate-200 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-100/50 transition-all duration-300 cursor-pointer">
                        <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                            <ClipboardCheck className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-semibold text-slate-900">Exam Evaluation</h3>
                        <p className="text-slate-600 leading-relaxed">
                            Automatically grade student submissions with AI-powered evaluation. 
                            Get detailed feedback, partial credit scoring, and learning suggestions for each answer.
                        </p>
                    </div>
                </div>
                
                {/* Pricing Section */}
                <div className="mt-24 text-center pb-8">
                    <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Simple, Transparent Pricing</h2>
                    <p className="text-slate-600 mb-12 text-lg">Start free, upgrade when you need more</p>
                    
                    <PricingPlans />
                </div>
            </main>
            
            {/* Footer */}
            <footer className="relative z-10 border-t border-slate-200 bg-white py-12">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <Image 
                                    src="/logo.png" 
                                    alt="AsKura Logo" 
                                    width={100} 
                                    height={32} 
                                    className="h-8 w-auto"
                                />
                                <span className="font-semibold text-slate-700">AsKura</span>
                            </div>
                            <span className="text-slate-500 text-sm">© 2026 AsKura. All rights reserved.</span>
                        </div>
                        <div className="flex items-center gap-8 text-sm text-slate-600">
                            <Link href="/terms" className="hover:text-blue-600 transition-colors duration-200 cursor-pointer">Terms</Link>
                            <Link href="/privacy" className="hover:text-blue-600 transition-colors duration-200 cursor-pointer">Privacy</Link>
                            <Link href="/contact" className="hover:text-blue-600 transition-colors duration-200 cursor-pointer">Contact</Link>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}
