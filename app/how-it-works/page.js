'use client';
import Link from 'next/link';
import { useState } from 'react';

const faqs = [
  {
    q: "Is this real money?",
    a: "No. Everyone starts with $1,000 of play money each week. You can't deposit, withdraw, or lose anything real. The only thing at stake is your spot on the leaderboard."
  },
  {
    q: "Why does my $50 bet only move the price by 2%?",
    a: "Markets have a liquidity depth parameter that controls how sensitive prices are to individual trades. This prevents one person from swinging a market 30% on a $20 bet — price impact scales with conviction and volume, not just any single trade."
  },
  {
    q: "I bet YES and the market went up, but my balance didn't change yet. Why?",
    a: "Your balance only changes when a market resolves. While a market is open, your shares sit in your portfolio. When it resolves YES, your YES shares pay out. When it resolves NO, they don't. Check your positions on your profile page."
  },
  {
    q: "Can I sell before the market resolves?",
    a: "Yes. Go to the market page — if you have an open position, there's a sell button. You'll get back the current market value of your shares, which may be more or less than what you paid depending on where the price moved."
  },
  {
    q: "Who resolves markets and how do I know it's fair?",
    a: "Markets are resolved by the Predict Cornell admin team based on pre-stated resolution rules written when the market was created. Every market shows its resolution criteria. If a market is ambiguous or the outcome can't be determined, it gets cancelled and everyone is refunded."
  },
  {
    q: "My weekly balance reset and I lost my profits. What happened?",
    a: "Each weekly reset snapshots standings first, then sets everyone back to $1,000 so a new race can start. Weekly rankings include your open-position value. Your all-time performance lives in lifetime earnings, which never resets."
  },
  {
    q: "Can I suggest a market?",
    a: "Yes — hit 'Call for Markets' in the nav. Fill out the question, your suggested probability, and resolution criteria. The admin team reviews all submissions."
  },
  {
    q: "What's the leaderboard actually measuring?",
    a: "Weekly: your net P&L from $1,000 since Monday. If you're at $1,340 you're up $340 for the week. Lifetime: cumulative net across all time — winnings minus losses. The oracle badge goes to whoever's on top all-time."
  }
];

function FAQ({ q, a }) {
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
        }}>{a}</p>
      )}
    </div>
  );
}

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
          marginBottom: '1rem'
        }}>
          How it <em style={{ color: 'var(--red)' }}>works</em>
        </h1>
        <p style={{
          fontFamily: 'var(--sans)',
          fontSize: '1rem',
          lineHeight: 1.6,
          color: 'var(--text-dim)',
          marginBottom: '3.5rem'
        }}>
          Prediction markets let you put your beliefs on the line. 
          The price is whatever the crowd collectively thinks is true right now — 
          and you can agree, disagree, or change your mind before it resolves.
        </p>

        {/* The basics */}
        <section style={{ marginBottom: '3rem' }}>
          <p style={{
            fontFamily: 'var(--mono)', fontSize: '0.6rem', textTransform: 'uppercase',
            letterSpacing: '0.12em', color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem'
          }}>
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
              { step: '02', title: 'Bet YES or NO', body: 'Choose your side and drop in how much play money you want to risk. You\'ll see exactly how many shares you get before confirming.' },
              { step: '03', title: 'Watch the price', body: 'Every trade moves the probability. If more people bet YES after you, the price goes up and your position gains value.' },
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
          <p style={{
            fontFamily: 'var(--mono)', fontSize: '0.6rem', textTransform: 'uppercase',
            letterSpacing: '0.12em', color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem'
          }}>
            <span style={{ width: '14px', height: '1px', background: 'var(--red)', display: 'inline-block' }} />
            What the % means
          </p>

          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: '8px', padding: '1.5rem'
          }}>
            <p style={{
              fontFamily: 'var(--sans)', fontSize: '0.9rem', lineHeight: 1.65,
              color: 'var(--text-dim)', marginBottom: '1rem'
            }}>
              When a market shows <strong style={{ color: 'var(--text)' }}>73%</strong>, that&apos;s not
              Cornell&apos;s official position or a stat from somewhere — it&apos;s the price that emerges from
              everyone&apos;s trades. It means the crowd is collectively pricing YES as more likely than NO,
              and someone who disagrees can profit by betting the other way.
            </p>
            <p style={{
              fontFamily: 'var(--sans)', fontSize: '0.9rem', lineHeight: 1.65,
              color: 'var(--text-dim)', marginBottom: '1rem'
            }}>
              Prices move when trades happen. A $10 bet moves the price a little. A $200 bet moves 
              it more. This is intentional — it means big swings require conviction, not just noise.
            </p>
            <p style={{
              fontFamily: 'var(--mono)', fontSize: '0.72rem', lineHeight: 1.5,
              color: 'var(--text-muted)', borderTop: '1px solid var(--border)',
              paddingTop: '1rem', marginTop: '0'
            }}>
              Under the hood: pricing runs on LMSR (Logarithmic Market Scoring Rule), 
              a formula from mechanism design that guarantees there&apos;s always a price on both sides
              and that the market can&apos;t be drained.{` `}
              <a
                href="https://mason.gmu.edu/~rhanson/mktscore.pdf"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--red)', textDecoration: 'underline' }}
              >
                Hanson (2007)
              </a>{' '}
              if you want the math.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section style={{ marginBottom: '3rem' }}>
          <p style={{
            fontFamily: 'var(--mono)', fontSize: '0.6rem', textTransform: 'uppercase',
            letterSpacing: '0.12em', color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem'
          }}>
            <span style={{ width: '14px', height: '1px', background: 'var(--red)', display: 'inline-block' }} />
            FAQ
          </p>
          <div style={{ border: '1px solid var(--border)', borderRadius: '8px', 
            overflow: 'hidden', background: 'var(--surface)', padding: '0 1.5rem' }}>
            {faqs.map((faq, i) => (
              <FAQ key={i} q={faq.q} a={faq.a} />
            ))}
          </div>
        </section>

        <Link href="/markets/active" style={{
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
