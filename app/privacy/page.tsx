import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/" className="text-sm text-blue-600 hover:text-blue-700">
          Back to home
        </Link>
        <h1 className="mt-6 text-3xl font-bold">Privacy Policy</h1>
        <p className="mt-4 text-muted-foreground">
          This page summarizes how the platform handles account data and uploaded educational content.
        </p>
        <div className="mt-8 space-y-6 text-sm leading-6">
          <section>
            <h2 className="text-lg font-semibold">Data We Use</h2>
            <p className="mt-2 text-muted-foreground">
              The platform stores account information, uploaded files, generated outputs, and usage information
              needed to provide the teaching tools.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Student Work</h2>
            <p className="mt-2 text-muted-foreground">
              Student submissions should be uploaded only when you have a valid educational reason and permission
              to process them. Review files carefully before sharing or exporting reports.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Security</h2>
            <p className="mt-2 text-muted-foreground">
              We use authenticated access and server-side AI configuration to reduce unnecessary exposure of API
              keys and uploaded materials.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
