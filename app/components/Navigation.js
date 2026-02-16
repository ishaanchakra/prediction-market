'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { usePathname, useRouter } from 'next/navigation';
import { collection, query, where, doc, onSnapshot } from 'firebase/firestore';

const ADMIN_EMAILS = ['ichakravorty14@gmail.com', 'ic367@cornell.edu'];

function initialsFor(user) {
  if (!user?.email) return 'PC';
  const prefix = user.email.split('@')[0];
  const parts = prefix.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return prefix.slice(0, 2).toUpperCase();
}

export default function Navigation() {
  const [user, setUser] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [balance, setBalance] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileMenuPath, setMobileMenuPath] = useState('');
  const router = useRouter();
  const pathname = usePathname();

  const isAdmin = useMemo(() => !!(user?.email && ADMIN_EMAILS.includes(user.email)), [user]);

  useEffect(() => {
    let unsubscribeUnread = null;
    let unsubscribeBalance = null;

    const unsubscribeAuth = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);

      if (unsubscribeUnread) {
        unsubscribeUnread();
        unsubscribeUnread = null;
      }
      if (unsubscribeBalance) {
        unsubscribeBalance();
        unsubscribeBalance = null;
      }

      if (currentUser) {
        const unreadQuery = query(
          collection(db, 'notifications'),
          where('userId', '==', currentUser.uid),
          where('read', '==', false)
        );
        unsubscribeUnread = onSnapshot(
          unreadQuery,
          (snapshot) => setUnreadCount(snapshot.size),
          (error) => console.error('Error listening to unread notifications:', error)
        );

        unsubscribeBalance = onSnapshot(
          doc(db, 'users', currentUser.uid),
          (userDoc) => setBalance(userDoc.exists() ? Number(userDoc.data().weeklyRep || 0) : 0),
          (error) => console.error('Error listening to user balance:', error)
        );
      } else {
        setUnreadCount(0);
        setBalance(0);
      }
    });

    return () => {
      if (unsubscribeUnread) unsubscribeUnread();
      if (unsubscribeBalance) unsubscribeBalance();
      unsubscribeAuth();
    };
  }, []);

  const menuVisible = mobileMenuOpen && mobileMenuPath === pathname;

  async function handleLogout() {
    try {
      await signOut(auth);
      router.push('/login');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }

  return (
    <nav
      className="sticky top-0 z-50 border-b border-[var(--border)] bg-[rgba(8,8,8,0.92)] backdrop-blur-[16px]"
      style={{
        paddingTop: 'calc(0.75rem + var(--safe-top))',
        paddingBottom: '0.75rem',
        paddingLeft: 'max(1rem, var(--safe-left))',
        paddingRight: 'max(1rem, var(--safe-right))'
      }}
    >
      <div className="grid grid-cols-[1fr_auto] items-center gap-2 md:grid-cols-[1fr_auto_1fr]">
        <Link href="/" className="justify-self-start flex items-center gap-2 no-underline">
          <span className="dot-pulse h-[7px] w-[7px] rounded-full bg-[var(--red)] shadow-[0_0_6px_var(--red)]" />
          <span className="font-sans text-sm font-extrabold tracking-[-0.025em] text-[var(--text)] md:text-base">
            Predict <em className="not-italic text-[var(--red)]">Cornell</em>
          </span>
          <span className="rounded border border-[rgba(217,119,6,0.35)] bg-[rgba(217,119,6,0.12)] px-1.5 py-[0.15rem] font-mono text-[0.52rem] font-bold uppercase tracking-[0.08em] text-[var(--amber-bright)]">
            Beta
          </span>
        </Link>

        <ul className="hidden md:flex md:justify-self-center list-none items-center gap-[0.15rem]">
          <li>
            <Link href="/markets/active" className="rounded px-[0.7rem] py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text)]">
              Markets
            </Link>
          </li>
          <li>
            <Link href="/leaderboard" className="rounded px-[0.7rem] py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text)]">
              Leaderboard
            </Link>
          </li>
          <li>
            <Link href="/call-for-markets" className="rounded px-[0.7rem] py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text)]">
              Call for Markets
            </Link>
          </li>
          <li>
            <Link href="/how-it-works" className="rounded px-[0.7rem] py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text)]">
              How It Works
            </Link>
          </li>
        </ul>

        <div className="justify-self-end flex items-center gap-2 md:gap-3">
          {user ? (
            <>
              <div className="flex items-center gap-1 rounded border border-[var(--border2)] px-2 py-[0.3rem] font-mono text-[0.65rem] text-[var(--text-dim)] md:gap-2 md:px-3 md:text-[0.7rem]">
                <span className="hidden sm:inline">balance</span>
                <strong className="text-[0.75rem] text-[var(--amber-bright)] md:text-[0.8rem]">
                  ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>
              </div>
              <Link
                href="/notifications"
                style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px' }}
              >
                <svg
                  width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor"
                  strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                  style={{ color: unreadCount > 0 ? 'var(--text)' : 'var(--text-muted)', transition: 'color 0.12s' }}
                >
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {unreadCount > 0 && (
                  <span style={{
                    position: 'absolute', top: '-2px', right: '-2px',
                    minWidth: '16px', height: '16px',
                    background: 'var(--red)',
                    borderRadius: '99px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--mono)', fontSize: '9px',
                    fontWeight: 700, color: 'white',
                    padding: '0 3px',
                    lineHeight: 1
                  }}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
              <Link href="/profile" className="relative flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border2)] bg-[var(--red-glow)] font-mono text-[0.6rem] font-bold text-[var(--red)]">
                {initialsFor(user)}
              </Link>
              <div className="hidden md:flex md:items-center md:gap-3">
                {isAdmin && (
                  <Link href="/admin" className="inline-flex h-7 items-center justify-center rounded px-[0.5rem] py-[0.25rem] font-mono text-[0.58rem] leading-none uppercase tracking-[0.06em] text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)]">
                    Admin
                  </Link>
                )}
                <button onClick={handleLogout} className="inline-flex h-7 items-center justify-center rounded px-[0.5rem] py-[0.25rem] font-mono text-[0.58rem] leading-none uppercase tracking-[0.06em] text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)]">
                  Logout
                </button>
              </div>
            </>
          ) : (
            <Link href="/login" className="rounded border border-[var(--border2)] px-3 py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)]">
              Sign In
            </Link>
          )}

          <button
            onClick={() => {
              setMobileMenuOpen((prev) => {
                const next = !prev;
                if (next) {
                  setMobileMenuPath(pathname || '');
                }
                return next;
              });
            }}
            className="md:hidden flex h-11 w-11 items-center justify-center rounded border border-[var(--border2)] text-[var(--text-dim)]"
            aria-label="Toggle menu"
          >
            <span className="font-mono text-lg">{menuVisible ? '×' : '≡'}</span>
          </button>
        </div>
      </div>

      {menuVisible && (
        <div
          className="md:hidden fixed left-0 right-0 z-[70] border-b border-[var(--border)] bg-[rgba(8,8,8,0.98)]"
          style={{ top: 'calc(56px + var(--safe-top))', paddingBottom: 'calc(0.75rem + var(--safe-bottom))' }}
        >
          <div className="flex flex-col px-4 py-2">
            <Link href="/markets/active" className="flex min-h-[52px] items-center border-b border-[var(--border)] px-1 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">
              Markets
            </Link>
            <Link href="/leaderboard" className="flex min-h-[52px] items-center border-b border-[var(--border)] px-1 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">
              Leaderboard
            </Link>
            <Link href="/call-for-markets" className="flex min-h-[52px] items-center border-b border-[var(--border)] px-1 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">
              Call for Markets
            </Link>
            <Link href="/how-it-works" className="flex min-h-[52px] items-center border-b border-[var(--border)] px-1 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">
              How It Works
            </Link>
            {user && isAdmin && (
              <Link href="/admin" className="flex min-h-[52px] items-center border-b border-[var(--border)] px-1 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">
                Admin
              </Link>
            )}
            {user && (
              <button
                onClick={handleLogout}
                className="flex min-h-[52px] items-center px-1 text-left font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--text-dim)]"
              >
                Logout
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
