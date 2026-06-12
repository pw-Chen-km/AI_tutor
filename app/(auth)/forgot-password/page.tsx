import Link from 'next/link';

export default function ForgotPasswordPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@example.com';

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Forgot password?</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Password reset is handled by the platform administrator for now. Email support and include the account
          email you use to sign in.
        </p>
        <a
          className="mt-6 block rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-blue-700"
          href={`mailto:${supportEmail}?subject=Password reset request`}
        >
          Email support
        </a>
        <Link href="/login" className="mt-4 block text-center text-sm text-blue-600 hover:text-blue-700">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
