'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { usePathname, useRouter } from 'next/navigation';
import { collection, query, where, doc, onSnapshot, orderBy, limit, getDoc } from 'firebase/firestore';
import { ADMIN_EMAILS } from '@/utils/adminEmails';
import { toMarketplaceMemberId } from '@/utils/marketplace';

function isPermissionDenied(error) {
  return error?.code === 'permission-denied'
    || String(error?.message || '').toLowerCase().includes('missing or insufficient permissions');
}

function NavIcon({ icon, className = 'h-[18px] w-[18px]' }) {
  const baseProps = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.8',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  };

  if (icon === 'feed') {
    return (
      <svg {...baseProps}>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }
  if (icon === 'markets') {
    return (
      <svg {...baseProps}>
        <path d="M3 3h18M3 9h18M3 15h12M3 21h8" />
      </svg>
    );
  }
  if (icon === 'leaderboard') {
    return (
      <svg {...baseProps}>
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </svg>
    );
  }
  if (icon === 'portfolio' || icon === 'profile') {
    return (
      <svg {...baseProps}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    );
  }
  if (icon === 'notifications') {
    return (
      <svg {...baseProps}>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    );
  }
  if (icon === 'admin') {
    return (
      <svg {...baseProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.1a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.1a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2H9a1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.1a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1V9c0 .4.2.8.6.9H20a2 2 0 1 1 0 4h-.1a1 1 0 0 0-.9.6z" />
      </svg>
    );
  }
  if (icon === 'home') {
    return (
      <svg {...baseProps}>
        <path d="M3 11.5L12 4l9 7.5" />
        <path d="M6 10.5V20h12v-9.5" />
        <path d="M10 20v-6h4v6" />
      </svg>
    );
  }
  if (icon === 'call') {
    return (
      <svg {...baseProps}>
        <path d="M3 11v2a2 2 0 0 0 2 2h1l3 4h3l-1.5-4H13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2" />
        <path d="M15 9l6-3v12l-6-3" />
      </svg>
    );
  }
  if (icon === 'about') {
    return (
      <svg {...baseProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5" />
        <path d="M12 8h.01" />
      </svg>
    );
  }
  return null;
}

function SidebarItem({ href, icon, label, active, badge = 0 }) {
  return (
    <Link
      href={href}
      title={label}
      className={`relative flex h-10 w-10 items-center justify-center rounded-[6px] transition-colors ${
        active
          ? 'bg-[var(--surface2)] text-[var(--text)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--surface2)] hover:text-[var(--text-dim)]'
      }`}
    >
      <NavIcon icon={icon} />
      {badge > 0 && (
        <span className="absolute -right-[3px] -top-[3px] flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[var(--red)] px-[3px] font-mono text-[8px] font-bold text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  );
}

export default function Navigation() {
  const [user, setUser] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [balance, setBalance] = useState(0);
  const [joinedMarketplaces, setJoinedMarketplaces] = useState([]);
  const [activeMarketplace, setActiveMarketplace] = useState(null);
  const [activeMarketplaceBalance, setActiveMarketplaceBalance] = useState(null);
  const router = useRouter();
  const pathname = usePathname();

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
  const isAdmin = useMemo(() => !!(user?.email && ADMIN_EMAILS.includes(user.email)), [user]);
  const displayBalance = inMarketplaceContext
    ? Number(activeMarketplaceBalance ?? balance)
    : Number(balance);

  const joinedMarketplaceCount = joinedMarketplaces.length;

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
          (userDoc) => {
            if (userDoc.exists()) {
              const data = userDoc.data();
              setBalance(Number(data.weeklyRep || 0));
            } else {
              setBalance(0);
            }
          },
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

  async function handleLogout() {
    try {
      await signOut(auth);
      router.push('/login');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }

  if (pathname === '/onboarding') return null;

  const isActive = (href) => {
    if (!pathname) return false;
    if (href === '/markets') {
      return pathname === '/markets'
        || pathname.startsWith('/marketplace')
        || pathname.startsWith('/market/');
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const bottomTabs = [
    { href: '/feed', icon: 'feed', label: 'Feed', badge: 0 },
    { href: '/markets', icon: 'markets', label: 'Markets', badge: 0 },
    { href: '/leaderboard', icon: 'leaderboard', label: 'Board', badge: 0 },
    { href: '/call-for-markets', icon: 'call', label: 'Call', badge: 0, accent: true },
    { href: '/how-it-works', icon: 'about', label: 'About', badge: 0 },
    { href: '/notifications', icon: 'notifications', label: 'Notifs', badge: unreadCount },
    { href: '/profile', icon: 'profile', label: 'Profile', badge: 0 },
  ];

  return (
    <>
      <nav className="hidden md:flex fixed left-0 top-0 bottom-0 z-50 w-16 flex-col items-center gap-[2px] border-r border-[var(--border)] bg-[rgba(8,8,8,0.96)] py-3 backdrop-blur-[12px]">
        <Link
          href="/"
          title="Home"
          className="mb-4 flex h-10 w-10 items-center justify-center rounded-[6px] border border-[var(--border2)] bg-[var(--surface)]"
        >
          <NavIcon icon="home" />
        </Link>

        <SidebarItem href="/feed" icon="feed" label="Feed" active={isActive('/feed')} />
        <SidebarItem
          href="/markets"
          icon="markets"
          label={joinedMarketplaceCount > 0 ? `Markets (${joinedMarketplaceCount} joined)` : 'Markets'}
          active={isActive('/markets')}
        />
        <SidebarItem href="/leaderboard" icon="leaderboard" label="Leaderboard" active={isActive('/leaderboard')} />
        <Link
          href="/call-for-markets"
          title="Call for Markets"
          className={`relative flex h-10 w-10 items-center justify-center rounded-[6px] transition-colors ${
            isActive('/call-for-markets')
              ? 'bg-[rgba(217,119,6,0.15)] text-[var(--amber-bright)]'
              : 'text-[var(--amber-bright)] hover:bg-[rgba(217,119,6,0.12)]'
          }`}
        >
          <NavIcon icon="call" />
        </Link>
        <SidebarItem href="/how-it-works" icon="about" label="About" active={isActive('/how-it-works')} />

        <div className="my-2 w-full border-t border-[var(--border)]" />
        <div className="flex flex-col items-center gap-[2px] py-1">
          <span className="font-mono text-[0.42rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">bal</span>
          <span className="font-mono text-[0.65rem] font-bold text-[var(--text)]">
            ${displayBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
        </div>
        <div className="w-full border-t border-[var(--border)]" />

        <SidebarItem href="/profile" icon="profile" label="Profile" active={isActive('/profile')} />
        <SidebarItem href="/notifications" icon="notifications" label="Notifications" active={isActive('/notifications')} badge={unreadCount} />
        {isAdmin && <SidebarItem href="/admin" icon="admin" label="Admin" active={isActive('/admin')} />}

        {user && (
          <button
            onClick={handleLogout}
            title="Logout"
            className="mt-auto flex h-10 w-10 items-center justify-center rounded-[6px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text-dim)]"
          >
            <span className="font-mono text-[0.5rem] uppercase tracking-[0.06em]">exit</span>
          </button>
        )}
      </nav>

      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-[var(--border)] bg-[rgba(8,8,8,0.96)] backdrop-blur-[12px]"
        style={{
          paddingBottom: 'calc(8px + var(--safe-bottom, 0px))',
          height: 'calc(56px + var(--safe-bottom, 0px))',
          paddingLeft: 'max(0px, var(--safe-left, 0px))',
          paddingRight: 'max(0px, var(--safe-right, 0px))'
        }}
      >
        {bottomTabs.map(({ href, icon, label, badge, accent }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-col items-center justify-center gap-[3px] px-4 py-2 ${
                active
                  ? (accent ? 'text-[var(--amber-bright)]' : 'text-[var(--text)]')
                  : (accent ? 'text-[var(--amber-bright)]' : 'text-[var(--text-muted)]')
              }`}
            >
              <span className={`transition-transform ${active ? 'scale-110' : ''}`}>
                <NavIcon icon={icon} className="h-[18px] w-[18px]" />
              </span>
              <span className="font-mono text-[0.42rem] uppercase tracking-[0.08em]">{label}</span>
              {badge > 0 && (
                <span className="absolute right-[6px] top-[4px] flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[var(--red)] px-[3px] font-mono text-[8px] font-bold text-white">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
