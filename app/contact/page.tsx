import Link from 'next/link';

export default function ContactPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@example.com';

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/" className="text-sm text-blue-600 hover:text-blue-700">
          Back to home
        </Link>
        <h1 className="mt-6 text-3xl font-bold">Contact</h1>
        <p className="mt-4 text-muted-foreground">
          For account help, school onboarding, or platform support, contact the product team.
        </p>
        <div className="mt-8 rounded-lg border bg-card p-6">
          <p className="text-sm text-muted-foreground">Support email</p>
          <a className="mt-1 block text-lg font-semibold text-blue-600 hover:text-blue-700" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>
        </div>
      </div>
    </main>
  );
}
