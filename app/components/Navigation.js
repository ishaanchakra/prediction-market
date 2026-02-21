'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { collection, query, where, doc, onSnapshot, orderBy, limit, getDoc } from 'firebase/firestore';
import { ADMIN_EMAILS } from '@/utils/adminEmails';
import { toMarketplaceMemberId } from '@/utils/marketplace';
import { CATEGORIES } from '@/utils/categorize';

function initialsFor(user) {
  if (!user?.email) return 'PC';
  const prefix = user.email.split('@')[0];
  const parts = prefix.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return prefix.slice(0, 2).toUpperCase();
}

function isPermissionDenied(error) {
  return error?.code === 'permission-denied'
    || String(error?.message || '').toLowerCase().includes('missing or insufficient permissions');
}

export default function Navigation() {
  const [user, setUser] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [balance, setBalance] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileMenuPath, setMobileMenuPath] = useState('');
  const [desktopMarketsOpen, setDesktopMarketsOpen] = useState(false);
  const [desktopMenuPath, setDesktopMenuPath] = useState('');
  const [joinedMarketplaces, setJoinedMarketplaces] = useState([]);
  const [activeMarketplace, setActiveMarketplace] = useState(null);
  const [activeMarketplaceBalance, setActiveMarketplaceBalance] = useState(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const routeMarketplaceId = useMemo(() => {
    if (!pathname?.startsWith('/marketplace/')) return null;
    const [, segment, id] = pathname.split('/');
    if (segment !== 'marketplace') return null;
    if (!id || id === 'enter') return null;
    return id;
  }, [pathname]);
  const routeMarketId = useMemo(() => {
    if (!pathname?.startsWith('/market/')) return null;
    const [, segment, id] = pathname.split('/');
    if (segment !== 'market') return null;
    if (!id || id === 'active') return null;
    return id;
  }, [pathname]);
  const [marketRouteMarketplaceId, setMarketRouteMarketplaceId] = useState(null);
  const activeMarketplaceId = routeMarketplaceId || marketRouteMarketplaceId;
  const inMarketplaceContext = !!activeMarketplaceId;
  const validMarketStatuses = useMemo(() => new Set(['all', 'active', 'resolved', 'cancelled']), []);
  const activeGlobalCategory = useMemo(() => {
    if (pathname !== '/markets') return 'all';
    const raw = searchParams.get('category');
    return CATEGORIES.some((category) => category.id === raw) ? raw : 'all';
  }, [pathname, searchParams]);
  const activeGlobalStatus = useMemo(() => {
    if (pathname !== '/markets') return 'all';
    const raw = searchParams.get('status');
    return validMarketStatuses.has(raw) ? raw : 'all';
  }, [pathname, searchParams, validMarketStatuses]);

  const isAdmin = useMemo(() => !!(user?.email && ADMIN_EMAILS.includes(user.email)), [user]);
  const displayBalance = inMarketplaceContext
    ? Number(activeMarketplaceBalance ?? balance)
    : Number(balance);
  const displayBalanceLabel = inMarketplaceContext
    ? `${activeMarketplace?.name || 'Marketplace'} wallet`
    : 'Global wallet';

  useEffect(() => {
    let cancelled = false;

    async function resolveMarketplaceFromMarketRoute() {
      if (!routeMarketId) {
        setMarketRouteMarketplaceId(null);
        return;
      }
      setMarketRouteMarketplaceId(null);

      try {
        const marketSnap = await getDoc(doc(db, 'markets', routeMarketId));
        if (cancelled) return;
        if (!marketSnap.exists()) {
          setMarketRouteMarketplaceId(null);
          return;
        }
        setMarketRouteMarketplaceId(marketSnap.data().marketplaceId || null);
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.error('Error resolving market route context:', error);
        }
        if (!cancelled) setMarketRouteMarketplaceId(null);
      }
    }

    resolveMarketplaceFromMarketRoute();
    return () => {
      cancelled = true;
    };
  }, [routeMarketId]);

  useEffect(() => {
    let unsubscribeUnread = null;
    let unsubscribeBalance = null;
    let unsubscribeMemberships = null;

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
      if (unsubscribeMemberships) {
        unsubscribeMemberships();
        unsubscribeMemberships = null;
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

        const membershipsQuery = query(
          collection(db, 'marketplaceMembers'),
          where('userId', '==', currentUser.uid),
          orderBy('joinedAt', 'desc'),
          limit(30)
        );
        unsubscribeMemberships = onSnapshot(
          membershipsQuery,
          async (snapshot) => {
            const rows = await Promise.all(
              snapshot.docs.map(async (membershipDoc) => {
                const membership = membershipDoc.data();
                try {
                  const marketplaceSnap = await getDoc(doc(db, 'marketplaces', membership.marketplaceId));
                  if (!marketplaceSnap.exists()) return null;
                  return {
                    ...membership,
                    marketplace: { id: marketplaceSnap.id, ...marketplaceSnap.data() }
                  };
                } catch (error) {
                  console.error('Error loading marketplace link:', error);
                  return null;
                }
              })
            );
            setJoinedMarketplaces(rows.filter(Boolean));
          },
          (error) => console.error('Error listening to marketplace memberships:', error)
        );
      } else {
        setUnreadCount(0);
        setBalance(0);
        setJoinedMarketplaces([]);
        setActiveMarketplace(null);
        setActiveMarketplaceBalance(null);
      }
    });

    return () => {
      if (unsubscribeUnread) unsubscribeUnread();
      if (unsubscribeBalance) unsubscribeBalance();
      if (unsubscribeMemberships) unsubscribeMemberships();
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    let unsubscribeActiveMember = null;
    let cancelled = false;

    async function loadMarketplaceContext() {
      if (!user || !activeMarketplaceId) {
        setActiveMarketplace(null);
        setActiveMarketplaceBalance(null);
        return;
      }

      unsubscribeActiveMember = onSnapshot(
        doc(db, 'marketplaceMembers', toMarketplaceMemberId(activeMarketplaceId, user.uid)),
        (memberSnap) => setActiveMarketplaceBalance(memberSnap.exists() ? Number(memberSnap.data().balance || 0) : null),
        (error) => console.error('Error listening to marketplace balance:', error)
      );

      try {
        const marketplaceSnap = await getDoc(doc(db, 'marketplaces', activeMarketplaceId));
        if (!cancelled) {
          setActiveMarketplace(marketplaceSnap.exists() ? { id: marketplaceSnap.id, ...marketplaceSnap.data() } : null);
        }
      } catch (error) {
        console.error('Error loading active marketplace:', error);
      }
    }

    loadMarketplaceContext();
    return () => {
      cancelled = true;
      if (unsubscribeActiveMember) unsubscribeActiveMember();
    };
  }, [activeMarketplaceId, user]);

  const menuVisible = mobileMenuOpen && mobileMenuPath === pathname;
  const desktopMenuVisible = desktopMarketsOpen && desktopMenuPath === pathname && !menuVisible;

  useEffect(() => {
    if (menuVisible) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [menuVisible]);

  async function handleLogout() {
    try {
      await signOut(auth);
      router.push('/login');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }

  if (pathname === '/onboarding') return null;

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
          <li
            className="relative"
            onMouseEnter={() => {
              setDesktopMenuPath(pathname || '');
              setDesktopMarketsOpen(true);
            }}
            onMouseLeave={() => setDesktopMarketsOpen(false)}
          >
            <button
              onClick={() => {
                setDesktopMarketsOpen(false);
                router.push('/markets');
              }}
              className={`inline-flex items-center gap-1 rounded px-[0.7rem] py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] transition-colors ${
                pathname === '/markets' || pathname?.startsWith('/marketplace/')
                  ? 'bg-[var(--surface2)] text-[var(--text)]'
                  : 'text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)]'
              }`}
            >
              Markets
              <span className="text-[0.55rem]">▾</span>
            </button>
            {desktopMenuVisible && (
              <div className="absolute left-0 top-full pt-1">
                <div className="min-w-[240px] overflow-hidden rounded border border-[var(--border2)] bg-[var(--surface)] shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
                  <Link
                    href="/markets"
                    onClick={() => setDesktopMarketsOpen(false)}
                    className={`flex min-h-[42px] items-center border-b border-[var(--border)] px-3 font-mono text-[0.64rem] uppercase tracking-[0.06em] transition-colors ${
                      pathname === '/markets'
                        ? 'bg-[rgba(220,38,38,0.12)] text-[var(--text)]'
                        : 'text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)]'
                    }`}
                  >
                    <span className="mr-2">📊</span>
                    All Markets
                    {pathname === '/markets' && <span className="ml-auto text-[var(--red)]">✓</span>}
                  </Link>
                  <div className="border-b border-[var(--border)] px-3 py-2 font-mono text-[0.52rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                    Global Categories
                  </div>
                  {CATEGORIES.filter((category) => category.id !== 'all').map((category) => {
                    const href = `/markets?status=active&category=${category.id}`;
                    const isCategoryActive = pathname === '/markets'
                      && activeGlobalStatus === 'active'
                      && activeGlobalCategory === category.id;
                    return (
                      <Link
                        key={`global-category-${category.id}`}
                        href={href}
                        onClick={() => setDesktopMarketsOpen(false)}
                        className={`flex min-h-[40px] items-center border-b border-[var(--border)] px-3 font-mono text-[0.62rem] uppercase tracking-[0.06em] transition-colors ${
                          isCategoryActive
                            ? 'bg-[rgba(220,38,38,0.12)] text-[var(--text)]'
                            : 'text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)]'
                        }`}
                      >
                        <span className="mr-2">{category.emoji}</span>
                        {category.label}
                        {isCategoryActive && <span className="ml-auto text-[var(--red)]">✓</span>}
                      </Link>
                    );
                  })}

                  <div className="border-b border-t border-[var(--border)] px-3 py-2 font-mono text-[0.52rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                    Joined Marketplaces
                  </div>
                  {joinedMarketplaces.length === 0 ? (
                    <span className="flex min-h-[42px] items-center px-3 font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                      none yet
                    </span>
                  ) : joinedMarketplaces.map((entry) => {
                    const isActive = pathname?.startsWith(`/marketplace/${entry.marketplace.id}`);
                    return (
                      <Link
                        key={entry.marketplace.id}
                        href={`/marketplace/${entry.marketplace.id}`}
                        onClick={() => setDesktopMarketsOpen(false)}
                        className={`flex min-h-[42px] items-center border-t border-[var(--border)] px-3 font-mono text-[0.62rem] uppercase tracking-[0.06em] ${
                          isActive
                            ? 'bg-[rgba(220,38,38,0.12)] text-[var(--text)]'
                            : 'text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)]'
                        }`}
                      >
                        {entry.marketplace.name}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </li>
          <li>
            <Link href="/leaderboard" className="rounded px-[0.7rem] py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text)]">
              Leaderboard
            </Link>
          </li>
          <li>
            <Link href="/marketplace/enter" className="rounded px-[0.7rem] py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text)]">
              Enter Marketplace
            </Link>
          </li>
          <li>
            <Link href="/call-for-markets" className="rounded px-[0.7rem] py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--amber-bright)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--amber-bright)]">
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
              <div className={`flex items-center gap-2 rounded-md border px-2.5 py-[0.35rem] font-mono md:px-3 ${
                inMarketplaceContext
                  ? 'border-[var(--red-dim)] bg-[var(--red-glow)]'
                  : 'border-[var(--border2)] bg-[var(--surface)]'
              }`}>
                <span className={`hidden sm:inline text-[0.54rem] uppercase tracking-[0.08em] ${
                  inMarketplaceContext ? 'text-[var(--red)]' : 'text-[var(--text-muted)]'
                }`}>{displayBalanceLabel}</span>
                <strong className={`text-[0.82rem] md:text-[0.9rem] ${
                  inMarketplaceContext ? 'text-[var(--amber-bright)]' : 'text-[var(--text)]'
                }`}>
                  ${displayBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
            <Link href="/login" className="inline-flex items-center justify-center rounded border border-[var(--border2)] px-3 py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)] md:min-h-0 md:min-w-0 md:h-7 md:py-0">
              Sign In
            </Link>
          )}

          <button
            onClick={() => {
              if (mobileMenuOpen && mobileMenuPath !== (pathname || '')) {
                setMobileMenuPath(pathname || '');
                return;
              }
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
            <Link
              href="/markets"
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-[52px] items-center border-b border-[var(--border)] px-1 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--text-dim)]"
            >
              📊 All Markets
            </Link>
            <div className="border-b border-[var(--border)] py-1">
              <div className="px-1 pb-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                Global Categories
              </div>
              {CATEGORIES.filter((category) => category.id !== 'all').map((category) => {
                const href = `/markets?status=active&category=${category.id}`;
                const isCategoryActive = pathname === '/markets'
                  && activeGlobalStatus === 'active'
                  && activeGlobalCategory === category.id;
                return (
                  <Link
                    key={`mobile-global-category-${category.id}`}
                    href={href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex min-h-[46px] items-center px-1 font-mono text-[0.66rem] uppercase tracking-[0.08em] ${
                      isCategoryActive ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'
                    }`}
                  >
                    <span className="mr-2">{category.emoji}</span>
                    {category.label}
                  </Link>
                );
              })}
            </div>
            <Link onClick={() => setMobileMenuOpen(false)} href="/leaderboard" className="flex min-h-[52px] items-center border-b border-[var(--border)] px-1 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">
              Leaderboard
            </Link>
            <Link onClick={() => setMobileMenuOpen(false)} href="/marketplace/enter" className="flex min-h-[52px] items-center border-b border-[var(--border)] px-1 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">
              Enter Marketplace
            </Link>
            {joinedMarketplaces.length > 0 && (
              <div className="border-b border-[var(--border)] py-1">
                <div className="px-1 pb-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                  Joined Marketplaces
                </div>
                {joinedMarketplaces.map((entry) => (
                  <Link
                    key={entry.marketplace.id}
                    href={`/marketplace/${entry.marketplace.id}`}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex min-h-[48px] items-center px-1 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-[var(--text-dim)]"
                  >
                    {entry.marketplace.name}
                  </Link>
                ))}
              </div>
            )}
            <Link onClick={() => setMobileMenuOpen(false)} href="/call-for-markets" className="flex min-h-[52px] items-center border-b border-[var(--border)] px-1 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--amber-bright)]">
              Call for Markets
            </Link>
            <Link onClick={() => setMobileMenuOpen(false)} href="/how-it-works" className="flex min-h-[52px] items-center border-b border-[var(--border)] px-1 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">
              How It Works
            </Link>
            {user && isAdmin && (
              <Link onClick={() => setMobileMenuOpen(false)} href="/admin" className="flex min-h-[52px] items-center border-b border-[var(--border)] px-1 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">
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
