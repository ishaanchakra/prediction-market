'use client';
import Link from 'next/link';
import { useState } from 'react';

const faqs = [
  {
    q: "Is this real money?",
    a: "No. Aside from the legal implications real money would bring, the primary purpose of PredictCornell is to forecast student sentiment. Our approach to equitizing the weight of everyone's opinions is to provide the same amount of in-game currency to everyone."
  },
  {
    q: "What's a marketplace?",
    a: "A marketplace is a private community of markets you can share with a smaller group. Marketplaces are public, but require a password (set by the marketplace creator) to join. Marketplace markets operate in the exact same way public markets do, but afford you the ability to share more personal markets with friends."
  },
  {
    q: "Who makes the markets?",
    a: "Predict Cornell admins create markets based on ongoing campus conversations: administrative decisions, sports, academic events, construction timelines, and other events. If there's a Cornell-specific question worth forecasting, it's here."
  },
  {
    q: "How can I submit market ideas?",
    a: null
  },
  {
    q: "Why does my $50 bet only move the price by 2%?",
    a: "Markets have a liquidity depth parameter; this is basically the market's sensitivity to bet sizes. This prevents one person from swinging a market 30% on a $20 bet, but price impact scales with conviction and volume, not just a single trade."
  },
  {
    q: "What happens to my rep at the end of the week?",
    a: "You start with $1,000 and receive a $50 stipend every Sunday night. Your balance carries over, so strong forecasters can compound over time. Lifetime P&L and Oracle Score still accumulate permanently."
  },
];

function FAQ({ q, a, aNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer'
      }}
      onClick={() => setOpen(!open)}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1rem 0'
      }}>
        <p style={{
          fontFamily: 'var(--sans)',
          fontSize: '0.95rem',
          fontWeight: 600,
          color: 'var(--text)',
          margin: 0
        }}>{q}</p>
        <span style={{
          fontFamily: 'var(--mono)',
          fontSize: '1rem',
          color: 'var(--red)',
          flexShrink: 0,
          marginLeft: '1rem',
          transition: 'transform 0.15s',
          display: 'inline-block',
          transform: open ? 'rotate(45deg)' : 'rotate(0deg)'
        }}>+</span>
      </div>
      {open && (
        <p style={{
          fontFamily: 'var(--sans)',
          fontSize: '0.88rem',
          lineHeight: 1.65,
          color: 'var(--text-dim)',
          margin: '0 0 1rem 0'
        }}>{aNode ?? a}</p>
      )}
    </div>
  );
}

const sectionLabel = {
  fontFamily: 'var(--mono)', fontSize: '0.6rem', textTransform: 'uppercase',
  letterSpacing: '0.12em', color: 'var(--text-muted)',
  display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem'
};

const bodyText = {
  fontFamily: 'var(--sans)', fontSize: '0.9rem', lineHeight: 1.65,
  color: 'var(--text-dim)', marginBottom: '1rem'
};

export default function HowItWorksPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '2.75rem 1rem 5rem' }}>

        {/* Header */}
        <p style={{
          fontFamily: 'var(--mono)',
          fontSize: '0.6rem',
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          color: 'var(--red)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '1rem'
        }}>
          <span style={{ display: 'inline-block', width: '20px', height: '1px', background: 'var(--red)' }} />
          Predict Cornell
        </p>
        <h1 style={{
          fontFamily: 'var(--display)',
          fontSize: 'clamp(2.2rem, 10vw, 3rem)',
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
          color: 'var(--text)',
          marginBottom: '3.5rem'
        }}>
          <em style={{ color: 'var(--red)' }}>What is this?</em>
        </h1>

        {/* About us */}
        <section style={{ marginBottom: '3rem' }}>
          <p style={sectionLabel}>
            <span style={{ width: '14px', height: '1px', background: 'var(--red)', display: 'inline-block' }} />
            About us
          </p>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: '8px', padding: '1.5rem'
          }}>
            <p style={bodyText}>
              PredictCornell is designed to gauge the sentiment of students towards on-campus outcomes.
              We create markets based on events around campus, enabling students to trade on how likely
              they believe those outcomes to be. The aggregate of those trades inform campus sentiment
              towards those events.
            </p>
          </div>
        </section>

        {/* What's a Prediction Market? */}
        <section style={{ marginBottom: '3rem' }}>
          <p style={sectionLabel}>
            <span style={{ width: '14px', height: '1px', background: 'var(--red)', display: 'inline-block' }} />
            What&apos;s a Prediction Market?
          </p>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: '8px', padding: '1.5rem'
          }}>
            <p style={{ ...bodyText, marginBottom: 0 }}>
              A prediction market is a market in which participants trade shares. The payoff of these
              shares depends on the outcome of a future event. Functionally, prediction markets treat
              beliefs as tradeable assets.
            </p>
          </div>
        </section>

        {/* The basics */}
        <section style={{ marginBottom: '3rem' }}>
          <p style={sectionLabel}>
            <span style={{ width: '14px', height: '1px', background: 'var(--red)', display: 'inline-block' }} />
            The basics
          </p>

          <div
            className="grid grid-cols-1 gap-[1px] sm:grid-cols-2"
            style={{
              background: 'var(--border)', borderRadius: '8px', overflow: 'hidden',
              border: '1px solid var(--border)', marginBottom: '1rem'
            }}
          >
            {[
              { step: '01', title: 'Pick a market', body: "Find a question you have an opinion on. Anything from \"Will the men's hockey team make regionals?\" to \"Will Arts Quad construction finish before May.\"" },
              { step: '02', title: 'Bet YES or NO', body: "Choose your side and decide how much of your weekly balance you want to risk. You'll see exactly how many shares you get before confirming." },
              { step: '03', title: 'Watch the price', body: 'Every trade moves the probability. If more people bet YES after you, the price goes up and your position gains value. You can exit your position at any time for a profit or a loss, depending on how the market has moved since your bet.' },
              { step: '04', title: 'Collect your payout', body: 'When the market resolves, winning shares pay out 1:1. Your balance updates instantly and your rank on the leaderboard shifts.' },
            ].map(({ step, title, body }) => (
              <div key={step} style={{
                background: 'var(--surface)', padding: '1.25rem 1.5rem'
              }}>
                <p style={{
                  fontFamily: 'var(--mono)', fontSize: '0.58rem',
                  color: 'var(--red)', marginBottom: '0.4rem', letterSpacing: '0.06em'
                }}>{step}</p>
                <p style={{
                  fontFamily: 'var(--sans)', fontSize: '0.9rem',
                  fontWeight: 700, color: 'var(--text)', marginBottom: '0.4rem'
                }}>{title}</p>
                <p style={{
                  fontFamily: 'var(--sans)', fontSize: '0.82rem',
                  lineHeight: 1.55, color: 'var(--text-dim)'
                }}>{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* What the % actually means */}
        <section style={{ marginBottom: '3rem' }}>
          <p style={sectionLabel}>
            <span style={{ width: '14px', height: '1px', background: 'var(--red)', display: 'inline-block' }} />
            What the % means
          </p>

          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: '8px', padding: '1.5rem'
          }}>
            <p style={bodyText}>
              When a market shows <strong style={{ color: 'var(--text)' }}>73%</strong>, it&apos;s the
              price that emerges from everyone&apos;s trades. It means the crowd is collectively pricing
              YES as more likely than NO, and someone who disagrees can profit by betting the other way.
              Prices move when trades happen. A $10 bet moves the price a little. A $200 bet moves it more.
            </p>
            <p style={{
              fontFamily: 'var(--mono)', fontSize: '0.72rem', lineHeight: 1.5,
              color: 'var(--text-muted)', borderTop: '1px solid var(--border)',
              paddingTop: '1rem', marginTop: '0'
            }}>
              Under the hood, we use the Logarithmic Market Scoring Rule (LMSR) formula, which
              guarantees there&apos;s always a price on both sides and that the market can&apos;t be drained.
              {' '}Learn more:{' '}
              <a
                href="https://mason.gmu.edu/~rhanson/mktscore.pdf"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--red)', textDecoration: 'underline' }}
              >
                Hanson (2007)
              </a>.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section style={{ marginBottom: '3rem' }}>
          <p style={sectionLabel}>
            <span style={{ width: '14px', height: '1px', background: 'var(--red)', display: 'inline-block' }} />
            FAQ
          </p>
          <div style={{ border: '1px solid var(--border)', borderRadius: '8px',
            overflow: 'hidden', background: 'var(--surface)', padding: '0 1.5rem' }}>
            {faqs.map((faq, i) => (
              <FAQ
                key={i}
                q={faq.q}
                a={faq.a}
                aNode={faq.a === null ? (
                  <>
                    We are always looking for new markets!{' '}
                    <Link href="/call-for-markets" style={{ color: 'var(--red)', textDecoration: 'underline' }}>
                      Click here
                    </Link>{' '}
                    to enter your question.
                  </>
                ) : undefined}
              />
            ))}
          </div>
        </section>

        <Link href="/markets?status=active" style={{
          display: 'inline-block',
          background: 'var(--red)',
          color: 'white',
          fontFamily: 'var(--mono)',
          fontSize: '0.72rem',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          padding: '0.75rem 1.75rem',
          borderRadius: '5px',
          textDecoration: 'none'
        }}>
          Start trading →
        </Link>

      </div>
    </div>
  );
}
