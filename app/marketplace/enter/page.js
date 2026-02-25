'use client';

import Link from 'next/link';

export default function EnterMarketplacePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-10 text-center">
        <div className="mb-6 text-5xl">🚧</div>
        <h1 className="mb-3 text-2xl font-bold text-[var(--text)]">Marketplaces are Coming Soon</h1>
        <p className="mb-8 text-sm leading-relaxed text-[var(--text-muted)]">
          We&apos;re making improvements to the Marketplaces feature. Check back here soon!
        </p>
        <Link
          href="/"
          className="inline-block rounded bg-[var(--amber-bright)] px-6 py-2 text-sm font-semibold text-black hover:opacity-90"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
