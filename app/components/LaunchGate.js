'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

const LAUNCH_PASSWORD = process.env.NEXT_PUBLIC_LAUNCH_PASSWORD || 'Hayek';
const LAUNCH_TIMESTAMP = parseInt(process.env.NEXT_PUBLIC_LAUNCH_TIMESTAMP || '1771855200000', 10);
const STORAGE_KEY = 'predictcornell_launch_auth';

export default function LaunchGate({ children }) {
  const router = useRouter();
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const now = Date.now();
      if (now >= LAUNCH_TIMESTAMP) {
        setIsUnlocked(true);
        setIsLoading(false);
        return;
      }

      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === LAUNCH_PASSWORD) {
          setIsUnlocked(true);
        }
      } catch {
        // localStorage unavailable
      }

      setIsLoading(false);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (isUnlocked) return undefined;

    function updateCountdown() {
      const now = Date.now();
      const diff = LAUNCH_TIMESTAMP - now;
      if (diff <= 0) {
        setIsUnlocked(true);
        return;
      }
      setTimeRemaining(diff);
    }

    const timeoutId = setTimeout(updateCountdown, 0);
    const interval = setInterval(updateCountdown, 1000);
    return () => {
      clearTimeout(timeoutId);
      clearInterval(interval);
    };
  }, [isUnlocked]);

  function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password === LAUNCH_PASSWORD) {
      try {
        localStorage.setItem(STORAGE_KEY, password);
      } catch {
        // localStorage unavailable
      }
      setIsUnlocked(true);
      router.replace('/login');
    } else {
      setError('Incorrect password');
      setPassword('');
    }
  }

  if (isLoading) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'var(--bg, #111111)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <p
          className="launch-loading"
          style={{
            fontFamily: 'var(--mono, monospace)',
            fontSize: '0.75rem',
            color: 'var(--text-muted, #4a4845)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em'
          }}
        >
          Loading...
        </p>
        <noscript>
          <style>{'.launch-loading{display:none!important;}'}</style>
          <LaunchGateUI
            password=""
            setPassword={() => {}}
            error=""
            timeRemaining={LAUNCH_TIMESTAMP}
            onSubmit={(e) => e.preventDefault()}
            disableInput
          />
        </noscript>
      </div>
    );
  }

  if (!isUnlocked) {
    return (
      <LaunchGateUI
        password={password}
        setPassword={setPassword}
        error={error}
        timeRemaining={timeRemaining}
        onSubmit={handleSubmit}
      />
    );
  }

  return children;
}

function LaunchGateUI({ password, setPassword, error, timeRemaining, onSubmit, disableInput = false }) {
  const [email, setEmail] = useState('');
  const [emailStatus, setEmailStatus] = useState('idle'); // 'idle' | 'submitting' | 'success' | 'error'
  const [emailError, setEmailError] = useState('');
  const countdown = formatCountdown(timeRemaining);

  async function handleEmailSubmit(e) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailStatus('submitting');
    setEmailError('');
    try {
      await setDoc(doc(db, 'waitlist', trimmed), {
        email: trimmed,
        submittedAt: serverTimestamp()
      });
      setEmailStatus('success');
    } catch (err) {
      console.error('Waitlist signup error:', err);
      setEmailStatus('error');
      setEmailError('Something went wrong. Try again.');
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--bg, #111111)',
        color: 'var(--text, #F0EDE8)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        fontFamily: 'var(--sans, sans-serif)',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 400 400\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")',
          opacity: 0.025,
          pointerEvents: 'none'
        }}
      />

      <div
        style={{
          maxWidth: '500px',
          width: '100%',
          textAlign: 'center',
          position: 'relative',
          zIndex: 1
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--display, serif)',
            fontSize: '3rem',
            fontStyle: 'italic',
            marginBottom: '1rem',
            color: 'var(--text, #F0EDE8)',
            lineHeight: 1.2
          }}
        >
          Predict Cornell
        </h1>


        {timeRemaining && (
          <div
            style={{
              marginBottom: '3rem',
              padding: '2rem',
              border: '1px solid var(--border, #2e2e2e)',
              borderRadius: '8px',
              background: 'var(--surface, #191919)'
            }}
          >
            <p
              style={{
                fontFamily: 'var(--mono, monospace)',
                fontSize: '0.6rem',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: 'var(--text-muted, #4a4845)',
                marginBottom: '1rem'
              }}
            >
              Launching in
            </p>
            <div
              style={{
                fontFamily: 'var(--mono, monospace)',
                fontSize: '2.5rem',
                fontWeight: 700,
                color: 'var(--red, #DC2626)',
                letterSpacing: '-0.02em',
                marginBottom: '0.5rem'
              }}
            >
              {countdown.main}
            </div>
            <p
              style={{
                fontFamily: 'var(--mono, monospace)',
                fontSize: '0.75rem',
                color: 'var(--text-dim, #7A7772)'
              }}
            >
              {countdown.sub}
            </p>
          </div>
        )}

        <div
          style={{
            padding: '2rem',
            border: '1px solid var(--border, #2e2e2e)',
            borderRadius: '8px',
            background: 'var(--surface, #191919)',
            marginBottom: '2rem'
          }}
        >
          <p
            style={{
              fontFamily: 'var(--sans, sans-serif)',
              fontSize: '0.95rem',
              color: 'var(--text-dim, #7A7772)',
              marginBottom: '1.5rem',
              lineHeight: 1.5
            }}
          >
            Have early access? Enter the password below.
          </p>

          <form onSubmit={onSubmit}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              disabled={disableInput}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                fontFamily: 'var(--mono, monospace)',
                fontSize: '0.9rem',
                background: 'var(--surface2, #222222)',
                border: `1px solid ${error ? 'var(--red, #DC2626)' : 'var(--border2, #3d3d3d)'}`,
                borderRadius: '6px',
                color: 'var(--text, #F0EDE8)',
                marginBottom: '1rem',
                outline: 'none',
                transition: 'border-color 0.2s',
                opacity: disableInput ? 0.7 : 1
              }}
            />

            {error && (
              <p
                style={{
                  fontFamily: 'var(--mono, monospace)',
                  fontSize: '0.75rem',
                  color: 'var(--red, #DC2626)',
                  marginBottom: '1rem',
                  textAlign: 'left'
                }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={disableInput}
              style={{
                width: '100%',
                padding: '0.75rem 1.5rem',
                fontFamily: 'var(--mono, monospace)',
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 700,
                background: 'var(--red, #DC2626)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: disableInput ? 'default' : 'pointer',
                opacity: disableInput ? 0.7 : 1
              }}
            >
              Unlock
            </button>
          </form>
        </div>

        <div
          style={{
            padding: '1.5rem 2rem',
            border: '1px solid var(--border, #2e2e2e)',
            borderRadius: '8px',
            background: 'var(--surface, #191919)',
            marginBottom: '1.5rem'
          }}
        >
          {emailStatus === 'success' ? (
            <p
              style={{
                fontFamily: 'var(--mono, monospace)',
                fontSize: '0.78rem',
                color: '#4ade80',
                margin: 0
              }}
            >
              ✓ You&apos;re on the list — we&apos;ll email you on launch day.
            </p>
          ) : (
            <>
              <p
                style={{
                  fontFamily: 'var(--mono, monospace)',
                  fontSize: '0.65rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: 'var(--text-muted, #4a4845)',
                  marginBottom: '1rem'
                }}
              >
                Get notified on launch day
              </p>
              <form onSubmit={handleEmailSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
                  placeholder="your@cornell.edu"
                  disabled={emailStatus === 'submitting'}
                  style={{
                    flex: 1,
                    padding: '0.6rem 0.85rem',
                    fontFamily: 'var(--mono, monospace)',
                    fontSize: '0.8rem',
                    background: 'var(--surface2, #222222)',
                    border: `1px solid ${emailError ? 'var(--red, #DC2626)' : 'var(--border2, #3d3d3d)'}`,
                    borderRadius: '6px',
                    color: 'var(--text, #F0EDE8)',
                    outline: 'none',
                    minWidth: 0
                  }}
                />
                <button
                  type="submit"
                  disabled={emailStatus === 'submitting'}
                  style={{
                    padding: '0.6rem 1rem',
                    fontFamily: 'var(--mono, monospace)',
                    fontSize: '0.65rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    fontWeight: 700,
                    background: 'transparent',
                    color: 'var(--text-dim, #7A7772)',
                    border: '1px solid var(--border2, #3d3d3d)',
                    borderRadius: '6px',
                    cursor: emailStatus === 'submitting' ? 'default' : 'pointer',
                    whiteSpace: 'nowrap',
                    opacity: emailStatus === 'submitting' ? 0.6 : 1
                  }}
                >
                  {emailStatus === 'submitting' ? '...' : 'Notify me'}
                </button>
              </form>
              {emailError && (
                <p
                  style={{
                    fontFamily: 'var(--mono, monospace)',
                    fontSize: '0.68rem',
                    color: 'var(--red, #DC2626)',
                    marginTop: '0.5rem',
                    textAlign: 'left'
                  }}
                >
                  {emailError}
                </p>
              )}
            </>
          )}
        </div>

        <p
          style={{
            fontFamily: 'var(--mono, monospace)',
            fontSize: '0.65rem',
            color: 'var(--text-muted, #4a4845)',
            lineHeight: 1.6
          }}
        >
          Follow{' '}
          <a
            href="https://instagram.com/predictcornell"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--red, #DC2626)',
              textDecoration: 'none',
              borderBottom: '1px solid var(--red, #DC2626)'
            }}
          >
            @predictcornell
          </a>{' '}
          for updates
        </p>
      </div>
    </div>
  );
}

function formatCountdown(ms) {
  if (!ms || ms <= 0) return { main: '00:00:00', sub: '' };

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, '0');

  if (days > 0) {
    return {
      main: `${days}d ${pad(hours)}h ${pad(minutes)}m`,
      sub: 'Monday, February 23 at 9:00 AM'
    };
  }

  return {
    main: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
    sub: hours > 0 ? 'hours : minutes : seconds' : 'minutes : seconds'
  };
}
