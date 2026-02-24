'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, where, getDocs, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import Link from 'next/link';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import MutedTrendBackground from '@/app/components/MutedTrendBackground';
import { useRouter } from 'next/navigation';

function probabilityClass(prob) {
  if (prob > 0.65) return 'text-[var(--green-bright)]';
  if (prob < 0.35) return 'text-[var(--red)]';
  return 'text-[var(--amber-bright)]';
}

function shortTag(market) {
  if (market.category) return market.category;
  return 'Market';
}

function asDateLabel(ts) {
  const date = ts?.toDate?.() || new Date();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isPermissionDenied(error) {
  return error?.code === 'permission-denied'
    || String(error?.message || '').toLowerCase().includes('missing or insufficient permissions');
}

export default function Home() {
  const router = useRouter();
  const [activeMarkets, setActiveMarkets] = useState([]);
  const [resolvedMarkets, setResolvedMarkets] = useState([]);
  const [trendSeriesByMarket, setTrendSeriesByMarket] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [user, setUser] = useState(null);
  const [loggedInReady, setLoggedInReady] = useState(false);
  const [stats, setStats] = useState({ balance: 1042.5, rank: '#3', totalTraded: 28440 });
  const [displayStats, setDisplayStats] = useState({
    activeMarkets: '14',
    balance: '$1,043',
    rank: '#3',
    totalTraded: '$28,440',
    settled: true
  });
  const displayStatsIntervalRef = useRef(null);
  const displayStatsCycleTimeoutRef = useRef(null);
  const displayStatsSettleTimeoutRef = useRef(null);
  const realStatsRef = useRef({
    activeMarkets: '14',
    balance: '$1,043',
    rank: '#3',
    totalTraded: '$28,440'
  });

  const resolvedTickerItems = useMemo(() => {
    const base = resolvedMarkets.slice(0, 7);
    return [...base, ...base];
  }, [resolvedMarkets]);
  const carouselItems = useMemo(() => [...activeMarkets.slice(0, 5), ...activeMarkets.slice(0, 5)], [activeMarkets]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setLoggedInReady(false);
        return;
      }
      try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists() && userDoc.data()?.onboardingComplete === false) {
          router.push('/onboarding');
          return;
        }
        setLoggedInReady(true);
      } catch (error) {
        console.error('Error checking onboarding guard:', error);
        setLoggedInReady(true);
      }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    const latestReal = {
      activeMarkets: `${activeMarkets.length || 14}`,
      balance: `$${Math.round(stats.balance).toLocaleString()}`,
      rank: stats.rank || '#3',
      totalTraded: `$${Math.round(stats.totalTraded).toLocaleString()}`
    };
    realStatsRef.current = latestReal;
    if (user) {
      setDisplayStats({ ...latestReal, settled: true });
    }
  }, [activeMarkets.length, stats.balance, stats.rank, stats.totalTraded, user]);

  useEffect(() => {
    if (user) {
      if (displayStatsIntervalRef.current) {
        clearInterval(displayStatsIntervalRef.current);
        displayStatsIntervalRef.current = null;
      }
      if (displayStatsCycleTimeoutRef.current) {
        clearTimeout(displayStatsCycleTimeoutRef.current);
        displayStatsCycleTimeoutRef.current = null;
      }
      if (displayStatsSettleTimeoutRef.current) {
        clearTimeout(displayStatsSettleTimeoutRef.current);
        displayStatsSettleTimeoutRef.current = null;
      }
      return undefined;
    }

    function randomInt(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function randomSettledValues() {
      return {
        activeMarkets: `${randomInt(8, 24)}`,
        balance: `$${randomInt(800, 1400).toLocaleString()}`,
        rank: `#${randomInt(1, 20)}`,
        totalTraded: `$${randomInt(18000, 40000).toLocaleString()}`
      };
    }

    function runLoop() {
      if (displayStatsIntervalRef.current) clearInterval(displayStatsIntervalRef.current);
      setDisplayStats((prev) => ({ ...prev, settled: false }));

      displayStatsIntervalRef.current = setInterval(() => {
        setDisplayStats({
          activeMarkets: `${randomInt(8, 24)}`,
          balance: `$${randomInt(800, 1400).toLocaleString()}`,
          rank: `#${randomInt(1, 20)}`,
          totalTraded: `$${randomInt(18000, 40000).toLocaleString()}`,
          settled: false
        });
      }, 80);

      displayStatsCycleTimeoutRef.current = setTimeout(() => {
        if (displayStatsIntervalRef.current) {
          clearInterval(displayStatsIntervalRef.current);
          displayStatsIntervalRef.current = null;
        }
        setDisplayStats({ ...randomSettledValues(), settled: true });

        displayStatsSettleTimeoutRef.current = setTimeout(() => {
          runLoop();
        }, 6000);
      }, 2000);
    }

    runLoop();

    return () => {
      if (displayStatsIntervalRef.current) {
        clearInterval(displayStatsIntervalRef.current);
        displayStatsIntervalRef.current = null;
      }
      if (displayStatsCycleTimeoutRef.current) {
        clearTimeout(displayStatsCycleTimeoutRef.current);
        displayStatsCycleTimeoutRef.current = null;
      }
      if (displayStatsSettleTimeoutRef.current) {
        clearTimeout(displayStatsSettleTimeoutRef.current);
        displayStatsSettleTimeoutRef.current = null;
      }
    };
  }, [user]);

  useEffect(() => {
    async function fetchData() {
      let active = [];
      try {
        setLoadError('');
        const activeQuery = query(
          collection(db, 'markets'),
          where('resolution', '==', null),
          where('marketplaceId', '==', null),
          limit(80)
        );
        const activeSnapshot = await getDocs(activeQuery);
        active = activeSnapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((m) => !m.marketplaceId)
          .filter((m) => getMarketStatus(m) !== MARKET_STATUS.CANCELLED)
          .sort((a, b) => (b.createdAt?.toDate?.()?.getTime?.() || 0) - (a.createdAt?.toDate?.()?.getTime?.() || 0));
        setActiveMarkets(active);
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.error('Error fetching active markets for homepage:', error);
        }
        setLoadError('Unable to load latest market data. Showing cached/partial data.');
      }

      try {
        const resolvedQuery = query(
          collection(db, 'markets'),
          where('marketplaceId', '==', null),
          limit(80)
        );
        const resolvedSnapshot = await getDocs(resolvedQuery);
        setResolvedMarkets(
          resolvedSnapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((market) => !market.marketplaceId && market.resolution != null)
            .sort((a, b) => (b.resolvedAt?.toDate?.()?.getTime?.() || 0) - (a.resolvedAt?.toDate?.()?.getTime?.() || 0))
            .slice(0, 3)
        );
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.error('Error fetching resolved markets for homepage:', error);
        }
      }

      try {
        if (user) {
          const trendEntries = await Promise.all(
            active.slice(0, 20).map(async (market) => {
              const betQuery = query(
                collection(db, 'bets'),
                where('marketplaceId', '==', null),
                where('marketId', '==', market.id),
                orderBy('timestamp', 'desc')
              );
              const betSnapshot = await getDocs(betQuery);
              const probs = betSnapshot.docs
                .map((d) => Number(d.data().probability))
                .filter((v) => Number.isFinite(v))
                .reverse();
              const initial = typeof market.initialProbability === 'number' ? market.initialProbability : (probs[0] ?? market.probability ?? 0.5);
              const series = probs.length ? [initial, ...probs] : [initial, initial];
              return [market.id, series];
            })
          );
          setTrendSeriesByMarket(Object.fromEntries(trendEntries));
        } else {
          setTrendSeriesByMarket({});
        }
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.error('Error fetching trend data for homepage:', error);
        }
      }

      let totalTraded = 28440;
      try {
        if (user) {
          const allBets = await getDocs(
            query(
              collection(db, 'bets'),
              where('marketplaceId', '==', null),
              limit(500)
            )
          );
          totalTraded = allBets.docs.reduce((sum, d) => {
            const bet = d.data();
            if (bet.marketplaceId) return sum;
            return sum + Math.abs(Number(bet.amount || 0));
          }, 0);
        }
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.error('Error fetching total traded stats for homepage:', error);
        }
      }

      try {
        if (user) {
          const usersQuery = query(collection(db, 'users'), orderBy('weeklyRep', 'desc'), limit(300));
          const usersSnapshot = await getDocs(usersQuery);
          const users = usersSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          const me = users.find((u) => u.id === user.uid);
          const rankIdx = users.findIndex((u) => u.id === user.uid);
          setStats({
            balance: Number(me?.weeklyRep || 1042.5),
            rank: rankIdx >= 0 ? `#${rankIdx + 1}` : '#3',
            totalTraded: Math.round(totalTraded || 28440)
          });
        } else {
          setStats((prev) => ({ ...prev, totalTraded: Math.round(totalTraded || 28440) }));
        }
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.error('Error fetching leaderboard stats for homepage:', error);
        }
        setStats((prev) => ({ ...prev, totalTraded: Math.round(totalTraded || 28440) }));
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <p className="font-mono text-[var(--text-muted)]">Loading markets...</p>
      </div>
    );
  }

  // Logged-in view
  if (user && loggedInReady) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
        <>
            {loadError && (
              <div className="mx-auto max-w-[1200px] px-4 pt-4 md:px-8">
                <div className="rounded border border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.08)] px-4 py-2 font-mono text-[0.65rem] text-[#f59e0b]">
                  {loadError}
                </div>
              </div>
            )}

            <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-8 border-b border-[var(--border)] px-4 pb-10 pt-10 md:gap-12 md:px-8 md:pb-12 lg:grid-cols-[1fr_420px] lg:items-center">
              <div>
                <div className="mb-5 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[var(--red)]">
                  <span className="inline-block h-px w-5 bg-[var(--red)]" />
                  Cornell University &middot; Spring 2026
                </div>
                <h1 className="mb-5 font-display text-4xl leading-[1.05] tracking-[-0.02em] text-[var(--text)] md:text-6xl">
                  What happens
                  <br />
                  next at <em className="text-[var(--red)]">Cornell</em>
                  <br />
                  is tradeable.
                </h1>
                <p className="mb-8 max-w-[480px] text-[0.95rem] leading-[1.6] text-[var(--text-dim)]">
                  Campus prediction markets. Bet on course outcomes, sports, construction timelines, and everything Cornell.
                </p>
                <div className="flex items-center gap-3">
                  <Link href="/markets?status=active" className="rounded-[5px] bg-[var(--red)] px-7 py-3 font-mono text-[0.75rem] uppercase tracking-[0.06em] text-white hover:bg-[var(--red-dim)]">
                    Browse Markets
                  </Link>
                  <Link href="/how-it-works" className="rounded-[5px] border border-[var(--border2)] px-7 py-3 font-mono text-[0.75rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]">
                    How It Works
                  </Link>
                </div>
              </div>
              <div className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--border)]">
                <HeroStat label="Active Markets" value={displayStats.activeMarkets} tone="red" settled={displayStats.settled} />
                <HeroStat label="Your Balance" value={displayStats.balance} tone="amber" settled={displayStats.settled} />
                <HeroStat label="Your Rank" value={displayStats.rank} tone="green" settled={displayStats.settled} />
                <HeroStat label="Total Traded" value={displayStats.totalTraded} tone="dim" settled={displayStats.settled} />
              </div>
            </div>

            <section className="mx-auto max-w-[1200px] px-4 py-8 md:px-8 md:py-10">
              <div className="mb-6 flex items-baseline justify-between">
                <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
                  &#x1F525; Hot Right Now
                </span>
                <Link href="/markets?status=active" className="font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:text-[var(--text)]">
                  View all markets &rarr;
                </Link>
              </div>
              <div className="carousel-wrap overflow-hidden">
                <div className="carousel-track gap-4 pb-2">
                  {carouselItems.map((market, idx) => (
                    <Link key={`${market.id}-${idx}`} href={`/market/${market.id}`} className="group relative block w-[300px] flex-shrink-0 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4 transition-all hover:-translate-y-[1px] md:p-5">
                      <MutedTrendBackground series={trendSeriesByMarket[market.id]} probability={market.probability} />
                      <span className={`mb-3 inline-block rounded border px-2 py-[0.15rem] font-mono text-[0.55rem] uppercase tracking-[0.08em] ${String(shortTag(market)).toLowerCase() === 'sports' ? 'border-[var(--red-dim)] text-[var(--red)]' : 'border-[var(--border2)] text-[var(--text-muted)]'}`}>
                        {shortTag(market)}
                      </span>
                      <div className="mb-4 min-h-[50px] text-[0.9rem] font-medium leading-[1.4] text-[var(--text)]">
                        {market.question}
                      </div>
                      <div className="mb-3 h-9 opacity-70" />
                      <div className="flex items-end justify-between">
                        <span className={`font-mono text-[1.9rem] font-bold leading-none tracking-[-0.04em] ${probabilityClass(Number(market.probability || 0))}`}>
                          {Math.round(Number(market.probability || 0) * 100)}%
                        </span>
                        <span className="text-right">
                          <span className="block font-mono text-[0.6rem] text-[var(--text-muted)]">
                            ${Math.round(Number(market.volume || market.totalVolume || 0)).toLocaleString()} traded
                          </span>
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </section>

            <hr className="mx-4 border-0 border-t border-[var(--border)] md:mx-8" />

            <section className="mx-auto max-w-[1200px] px-4 py-8 md:px-8 md:py-10">
              <div className="mb-6 flex items-baseline justify-between">
                <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
                  Recently Resolved Markets
                </span>
                <Link href="/markets?status=resolved" className="font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:text-[var(--text)]">
                  View all resolved &rarr;
                </Link>
              </div>
              {resolvedMarkets.length === 0 ? (
                <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-4 font-mono text-[0.68rem] text-[var(--text-muted)]">
                  No resolved global markets yet.
                </div>
              ) : (
                <div className="relative flex h-9 items-center overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
                  <div
                    className="flex w-max animate-[ticker-scroll_45s_linear_infinite] whitespace-nowrap"
                    style={{ animationDirection: 'reverse' }}
                  >
                    {resolvedTickerItems.map((market, idx) => (
                      <Link
                        key={`${market.id}-resolved-${idx}`}
                        href={`/market/${market.id}`}
                        className="inline-flex h-9 items-center gap-2 border-r border-[var(--border)] px-6 hover:bg-[var(--surface2)]"
                      >
                        <span className="max-w-[280px] overflow-hidden text-ellipsis font-mono text-[0.6rem] text-[var(--text-dim)]">
                          {market.question}
                        </span>
                        <span className={`rounded px-1.5 py-[0.15rem] font-mono text-[0.56rem] font-bold uppercase tracking-[0.06em] ${
                          market.resolution === 'YES'
                            ? 'border border-[rgba(22,163,74,.2)] bg-[rgba(22,163,74,.12)] text-[var(--green-bright)]'
                            : 'border border-[rgba(220,38,38,.2)] bg-[var(--red-glow)] text-[var(--red)]'
                        }`}>
                          {market.resolution}
                        </span>
                        <span className="font-mono text-[0.56rem] text-[var(--text-muted)]">{asDateLabel(market.resolvedAt)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </section>
        </>

        <footer className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-3 border-t border-[var(--border)] px-4 py-6 md:flex-row md:items-center md:px-8">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Predict Cornell &middot; BETA &middot; Spring 2026</span>
          <ul className="flex list-none gap-6">
            <li>
              <Link href="/how-it-works" className="font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-muted)] hover:text-[var(--text-dim)]">How It Works</Link>
            </li>
            <li>
              <Link href="/call-for-markets" className="font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-muted)] hover:text-[var(--text-dim)]">Call for Markets</Link>
            </li>
            <li>
              <Link href="/leaderboard" className="font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-muted)] hover:text-[var(--text-dim)]">Leaderboard</Link>
            </li>
          </ul>
        </footer>
      </div>
    );
  }

  // Logged-out view: marketing/conversion page
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {loadError && (
        <div className="mx-auto max-w-[1200px] px-4 pt-4 md:px-8">
          <div className="rounded border border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.08)] px-4 py-2 font-mono text-[0.65rem] text-[#f59e0b]">
            {loadError}
          </div>
        </div>
      )}
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-8 border-b border-[var(--border)] px-4 pb-10 pt-12 md:gap-12 md:px-8 md:pb-12 md:pt-20 lg:grid-cols-[1fr_420px] lg:items-center">
        <div>
          <div className="mb-5 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[var(--red)]">
            <span className="inline-block h-px w-5 bg-[var(--red)]" />
            Cornell University &middot; Spring 2026
          </div>
          <h1 className="mb-5 font-display text-4xl leading-[1.05] tracking-[-0.02em] text-[var(--text)] md:text-6xl">
            What happens
            <br />
            next at <em className="text-[var(--red)]">Cornell</em>
            <br />
            is tradeable.
          </h1>
          <p className="mb-8 max-w-[480px] text-[0.95rem] leading-[1.6] text-[var(--text-dim)]">
            Campus prediction markets. Bet on course outcomes, sports, construction timelines, and everything Cornell.
          </p>
          <div className="flex items-center gap-3">
            <Link href="/markets?status=active" className="rounded-[5px] bg-[var(--red)] px-7 py-3 font-mono text-[0.75rem] uppercase tracking-[0.06em] text-white hover:bg-[var(--red-dim)]">
              Start Trading
            </Link>
            <Link href="/how-it-works" className="rounded-[5px] border border-[var(--border2)] px-7 py-3 font-mono text-[0.75rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]">
              How It Works
            </Link>
          </div>
          <p className="mt-4 font-mono text-[0.6rem] tracking-[0.04em] text-[var(--text-muted)]">@cornell.edu required &middot; weekly reset leaderboard &middot; BETA</p>
        </div>

        <div className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--border)]">
          <HeroStat label="Active Markets" value={displayStats.activeMarkets} tone="red" settled={displayStats.settled} />
          <HeroStat label="Your Balance" value={displayStats.balance} tone="amber" settled={displayStats.settled} />
          <HeroStat label="Your Rank" value={displayStats.rank} tone="green" settled={displayStats.settled} />
          <HeroStat label="Total Traded" value={displayStats.totalTraded} tone="dim" settled={displayStats.settled} />
        </div>
      </div>

      <section className="mx-auto max-w-[1200px] px-4 py-8 md:px-8 md:py-10">
        <div className="mb-6 flex items-baseline justify-between">
          <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
            &#x1F525; Hot Right Now
          </span>
          <Link href="/markets?status=active" className="font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:text-[var(--text)]">
            View all markets &rarr;
          </Link>
        </div>
        <div className="carousel-wrap overflow-hidden">
          <div className="carousel-track gap-4 pb-2">
            {carouselItems.map((market, idx) => (
              <Link key={`${market.id}-${idx}`} href={`/market/${market.id}`} className="group relative block w-[300px] flex-shrink-0 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4 transition-all hover:-translate-y-[1px] md:p-5">
                <MutedTrendBackground series={trendSeriesByMarket[market.id]} probability={market.probability} />
                <span className={`mb-3 inline-block rounded border px-2 py-[0.15rem] font-mono text-[0.55rem] uppercase tracking-[0.08em] ${String(shortTag(market)).toLowerCase() === 'sports' ? 'border-[var(--red-dim)] text-[var(--red)]' : 'border-[var(--border2)] text-[var(--text-muted)]'}`}>
                  {shortTag(market)}
                </span>
                <div className="mb-4 min-h-[50px] text-[0.9rem] font-medium leading-[1.4] text-[var(--text)]">
                  {market.question}
                </div>
                <div className="mb-3 h-9 opacity-70" />
                <div className="flex items-end justify-between">
                  <span className={`font-mono text-[1.9rem] font-bold leading-none tracking-[-0.04em] ${probabilityClass(Number(market.probability || 0))}`}>
                    {Math.round(Number(market.probability || 0) * 100)}%
                  </span>
                  <span className="text-right">
                    <span className="block font-mono text-[0.6rem] text-[var(--text-muted)]">
                      ${Math.round(Number(market.volume || market.totalVolume || 0)).toLocaleString()} traded
                    </span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <hr className="mx-4 border-0 border-t border-[var(--border)] md:mx-8" />

      <section className="mx-auto max-w-[1200px] px-4 py-8 md:px-8 md:py-10">
        <div className="mb-6 flex items-baseline justify-between">
          <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
            Recently Resolved Markets
          </span>
          <Link href="/markets?status=resolved" className="font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:text-[var(--text)]">
            View all resolved &rarr;
          </Link>
        </div>
        {resolvedMarkets.length === 0 ? (
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-4 font-mono text-[0.68rem] text-[var(--text-muted)]">
            No resolved global markets yet.
          </div>
        ) : (
          <div className="relative flex h-9 items-center overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
            <div
              className="flex w-max animate-[ticker-scroll_45s_linear_infinite] whitespace-nowrap"
              style={{ animationDirection: 'reverse' }}
            >
              {resolvedTickerItems.map((market, idx) => (
                <Link
                  key={`${market.id}-resolved-${idx}`}
                  href={`/market/${market.id}`}
                  className="inline-flex h-9 items-center gap-2 border-r border-[var(--border)] px-6 hover:bg-[var(--surface2)]"
                >
                  <span className="max-w-[280px] overflow-hidden text-ellipsis font-mono text-[0.6rem] text-[var(--text-dim)]">
                    {market.question}
                  </span>
                  <span className={`rounded px-1.5 py-[0.15rem] font-mono text-[0.56rem] font-bold uppercase tracking-[0.06em] ${
                    market.resolution === 'YES'
                      ? 'border border-[rgba(22,163,74,.2)] bg-[rgba(22,163,74,.12)] text-[var(--green-bright)]'
                      : 'border border-[rgba(220,38,38,.2)] bg-[var(--red-glow)] text-[var(--red)]'
                  }`}>
                    {market.resolution}
                  </span>
                  <span className="font-mono text-[0.56rem] text-[var(--text-muted)]">{asDateLabel(market.resolvedAt)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      <footer className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-3 border-t border-[var(--border)] px-4 py-6 md:flex-row md:items-center md:px-8">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Predict Cornell &middot; BETA &middot; Spring 2026</span>
        <ul className="flex list-none gap-6">
          <li>
            <Link href="/how-it-works" className="font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-muted)] hover:text-[var(--text-dim)]">How It Works</Link>
          </li>
          <li>
            <Link href="/call-for-markets" className="font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-muted)] hover:text-[var(--text-dim)]">Call for Markets</Link>
          </li>
          <li>
            <Link href="/leaderboard" className="font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-muted)] hover:text-[var(--text-dim)]">Leaderboard</Link>
          </li>
        </ul>
      </footer>
    </div>
  );
}

function HeroStat({ label, value, tone, settled }) {
  const toneClass = tone === 'red'
    ? 'text-[var(--red)]'
    : tone === 'green'
      ? 'text-[var(--green-bright)]'
      : tone === 'amber'
        ? 'text-[var(--amber-bright)]'
        : 'text-[var(--text-dim)]';
  return (
    <div className="flex items-baseline justify-between bg-[var(--surface)] px-6 py-5">
      <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}</span>
      <span className={`font-mono text-[1.6rem] font-bold tracking-[-0.03em] transition-colors duration-300 ease-in-out ${settled ? toneClass : 'text-[var(--text-muted)]'}`}>{value}</span>
    </div>
  );
}
