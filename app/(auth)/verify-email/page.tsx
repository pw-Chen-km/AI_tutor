'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Mail } from 'lucide-react';

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-white p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-100/50 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-sky-100/50 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3" />
      </div>
      
      <Card className="w-full max-w-md bg-white/80 backdrop-blur-sm border-slate-200 shadow-xl shadow-slate-200/50 relative z-10">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <Link href="/" className="inline-flex items-center justify-center gap-2 mx-auto cursor-pointer group mb-4">
            <Image 
              src="/logo.png" 
              alt="AsKura Logo" 
              width={120} 
              height={40} 
              className="h-10 w-auto transition-transform duration-200 group-hover:scale-105"
            />
            <span className="text-lg font-bold text-slate-800">AsKura</span>
          </Link>
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-blue-500 to-sky-500 rounded-full flex items-center justify-center shadow-lg shadow-blue-500/30">
            <Mail className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Verify Your Email</h2>
          <p className="text-slate-600">
            Please check your email inbox for a verification link. 
            Click the link to activate your account.
          </p>
          <div className="pt-4 space-y-3">
            <Link href="/login">
              <Button className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20 transition-all duration-200 cursor-pointer">
                Go to Sign In
              </Button>
            </Link>
            <p className="text-slate-500 text-sm">
              Didn&apos;t receive an email?{' '}
              <button className="text-blue-600 hover:text-blue-700 transition-colors duration-200 cursor-pointer">
                Resend verification
              </button>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
