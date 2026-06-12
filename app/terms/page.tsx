import Link from 'next/link';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/" className="text-sm text-blue-600 hover:text-blue-700">
          Back to home
        </Link>
        <h1 className="mt-6 text-3xl font-bold">Terms of Service</h1>
        <p className="mt-4 text-muted-foreground">
          These terms describe the basic rules for using the AI Teaching Assistant platform.
        </p>
        <div className="mt-8 space-y-6 text-sm leading-6">
          <section>
            <h2 className="text-lg font-semibold">Use of the Service</h2>
            <p className="mt-2 text-muted-foreground">
              Teachers may upload instructional materials and student submissions to generate teaching content,
              study materials, and evaluation reports. Users are responsible for checking generated content before
              sharing it with students.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Uploaded Content</h2>
            <p className="mt-2 text-muted-foreground">
              Do not upload content that you do not have permission to use. Student information should be handled
              according to your school or organization policies.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">AI Output</h2>
            <p className="mt-2 text-muted-foreground">
              AI-generated results can contain mistakes. The platform is designed to assist teachers, not replace
              professional review or final academic judgment.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
