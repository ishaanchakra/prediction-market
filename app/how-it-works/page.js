'use client';
import Link from 'next/link';

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="max-w-4xl mx-auto px-6 py-12 text-[var(--text)]">
        <h1 className="mb-3 font-display text-5xl leading-[1.05] tracking-[-0.02em]">
          How Predict Cornell <em className="italic">Works</em>
        </h1>
        <p className="text-[var(--text-dim)] mb-8">
          This page gives the mechanics without heavy finance jargon. If you can read a chart and compare percentages,
          you can use this app well.
        </p>

        <div className="space-y-6">
          <section className="bg-[var(--surface)] rounded-xl p-6 border border-[var(--border)] text-[var(--text)]">
            <h2 className="text-2xl font-bold mb-2">About the Project</h2>
            <p className="text-sm leading-6">
              Predict Cornell is a campus prediction market where students trade on yes/no questions.
              The live percentage is a crowd estimate of how likely YES is right now.
            </p>
          </section>

          <section className="bg-[var(--surface)] rounded-xl p-6 border border-[var(--border)] text-[var(--text)]">
            <h2 className="text-2xl font-bold mb-2">How Trading Works</h2>
            <ol className="list-decimal ml-5 text-sm leading-6 space-y-1">
              <li>Pick YES or NO.</li>
              <li>Enter how much you want to risk.</li>
              <li>You receive shares for that side.</li>
              <li>When the market resolves, winning-side shares pay out.</li>
            </ol>
          </section>

          <section className="bg-[var(--surface)] rounded-xl p-6 border border-[var(--border)] text-[var(--text)]">
            <h2 className="text-2xl font-bold mb-2">Probability as a Crowd Estimate</h2>
            <p className="text-sm leading-6 mb-2">
              If a market is at 70%, that means traders collectively price YES as more likely than NO.
              It does not guarantee a result. It is a live estimate, updated by real trades.
            </p>
            <p className="text-sm leading-6">
              In short: probability here is a &quot;market belief&quot; number, not an official prediction from Cornell.
            </p>
          </section>

          <section className="bg-[var(--surface)] rounded-xl p-6 border border-[var(--border)] text-[var(--text)]">
            <h2 className="text-2xl font-bold mb-2">Shares and Payouts</h2>
            <p className="text-sm leading-6 mb-2">
              Shares are your position size. More shares means a bigger stake.
            </p>
            <p className="text-sm leading-6 mb-2">
              Example: You spend $30 on YES and receive 41.2 YES shares.
            </p>
            <ul className="list-disc ml-5 text-sm leading-6">
              <li>If resolved YES: those 41.2 shares pay out.</li>
              <li>If resolved NO: YES shares do not pay out.</li>
            </ul>
          </section>

          <section className="bg-[var(--surface)] rounded-xl p-6 border border-[var(--border)] text-[var(--text)]">
            <h2 className="text-2xl font-bold mb-2">Why Price Moves</h2>
            <p className="text-sm leading-6 mb-2">
              When someone buys YES, the system adds YES exposure and pushes YES probability up.
              When someone buys NO, YES probability moves down.
            </p>
            <p className="text-sm leading-6">
              Bigger trades move price more than small trades. This is intentional so the chart reflects conviction.
            </p>
          </section>

          <section className="bg-[var(--surface)] rounded-xl p-6 border border-[var(--border)] text-[var(--text)]">
            <h2 className="text-2xl font-bold mb-2">LMSR in Plain Language</h2>
            <p className="text-sm leading-6 mb-2">
              The app uses LMSR (Logarithmic Market Scoring Rule), a pricing formula designed for prediction markets.
              It keeps prices smooth and always gives a quote for both sides.
            </p>
            <p className="text-sm leading-6 mb-2">
              A liquidity parameter <code>b</code> controls sensitivity:
              higher <code>b</code> means prices move less per trade,
              lower <code>b</code> means prices react faster.
            </p>
            <p className="text-sm leading-6">
              Read the original paper: <a className="text-[var(--red)] underline font-semibold" href="https://mason.gmu.edu/~rhanson/mktscore.pdf" target="_blank" rel="noreferrer">Hanson (2007) on LMSR</a>.
            </p>
          </section>
        </div>

        <Link href="/" className="inline-block mt-8 text-[var(--text-dim)] underline font-semibold">
          ← Back to markets
        </Link>
      </div>
    </div>
  );
}
