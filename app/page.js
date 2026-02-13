'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, where, getDocs, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import Link from 'next/link';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import MutedTrendBackground from '@/app/components/MutedTrendBackground';

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

export default function Home() {
  const [activeMarkets, setActiveMarkets] = useState([]);
  const [resolvedMarkets, setResolvedMarkets] = useState([]);
  const [tickerMarkets, setTickerMarkets] = useState([]);
  const [trendSeriesByMarket, setTrendSeriesByMarket] = useState({});
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
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

  const tickerItems = useMemo(() => [...tickerMarkets, ...tickerMarkets], [tickerMarkets]);
  const carouselItems = useMemo(() => [...activeMarkets.slice(0, 5), ...activeMarkets.slice(0, 5)], [activeMarkets]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => setUser(currentUser));
    return () => unsubscribe();
  }, []);

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
      try {
        const activeQuery = query(collection(db, 'markets'), where('resolution', '==', null));
        const activeSnapshot = await getDocs(activeQuery);
        const active = activeSnapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((m) => getMarketStatus(m) !== MARKET_STATUS.CANCELLED)
          .sort((a, b) => (b.createdAt?.toDate?.()?.getTime?.() || 0) - (a.createdAt?.toDate?.()?.getTime?.() || 0));
        setActiveMarkets(active);
        setTickerMarkets(active.slice(0, 7));

        const resolvedQuery = query(collection(db, 'markets'), where('resolution', '!=', null), orderBy('resolvedAt', 'desc'), limit(12));
        const resolvedSnapshot = await getDocs(resolvedQuery);
        setResolvedMarkets(resolvedSnapshot.docs.map((d) => ({ id: d.id, ...d.data() })).slice(0, 3));

        const trendEntries = await Promise.all(
          active.slice(0, 20).map(async (market) => {
            const betQuery = query(collection(db, 'bets'), where('marketId', '==', market.id), orderBy('timestamp', 'asc'));
            const betSnapshot = await getDocs(betQuery);
            const probs = betSnapshot.docs.map((d) => Number(d.data().probability)).filter((v) => Number.isFinite(v));
            const initial = typeof market.initialProbability === 'number' ? market.initialProbability : (probs[0] ?? market.probability ?? 0.5);
            const series = probs.length ? [initial, ...probs] : [initial, initial];
            return [market.id, series];
          })
        );
        setTrendSeriesByMarket(Object.fromEntries(trendEntries));

        const allBets = await getDocs(collection(db, 'bets'));
        const totalTraded = allBets.docs.reduce((sum, d) => sum + Math.abs(Number(d.data().amount || 0)), 0);

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
        console.error('Error fetching homepage data:', error);
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

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="relative flex h-7 items-center overflow-hidden border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="flex w-max animate-[ticker-scroll_45s_linear_infinite] whitespace-nowrap">
          {tickerItems.map((market, idx) => (
            <div key={`${market.id}-${idx}`} className="inline-flex h-7 items-center gap-2 border-r border-[var(--border)] px-6">
              <span className="max-w-[200px] overflow-hidden text-ellipsis font-mono text-[0.6rem] text-[var(--text-dim)]">
                {market.question}
              </span>
              <span className={`font-mono text-[0.65rem] font-bold ${probabilityClass(Number(market.probability || 0))}`}>
                {Math.round(Number(market.probability || 0) * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-12 border-b border-[var(--border)] px-8 pb-12 pt-20 lg:grid-cols-[1fr_420px] lg:items-center">
        <div>
          <div className="mb-5 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[var(--red)]">
            <span className="inline-block h-px w-5 bg-[var(--red)]" />
            Cornell University · Spring 2025
          </div>
          <h1 className="mb-5 font-display text-[3.8rem] leading-[1.05] tracking-[-0.02em] text-[var(--text)]">
            What happens
            <br />
            next at <em className="text-[var(--red)]">Cornell</em>
            <br />
            is tradeable.
          </h1>
          <p className="mb-8 max-w-[480px] text-[0.95rem] leading-[1.6] text-[var(--text-dim)]">
            Campus prediction markets. Bet on course outcomes, sports, construction timelines, and everything Cornell. The crowd is usually right.
          </p>
          <div className="flex items-center gap-3">
            <Link href="/markets/active" className="rounded-[5px] bg-[var(--red)] px-7 py-3 font-mono text-[0.75rem] uppercase tracking-[0.06em] text-white hover:bg-[var(--red-dim)]">
              Start Trading
            </Link>
            <Link href="/how-it-works" className="rounded-[5px] border border-[var(--border2)] px-7 py-3 font-mono text-[0.75rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]">
              How It Works
            </Link>
          </div>
          <p className="mt-4 font-mono text-[0.6rem] tracking-[0.04em] text-[var(--text-muted)]">@cornell.edu required · play money only · BETA</p>
        </div>

        <div className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--border)]">
          <HeroStat label="Active Markets" value={displayStats.activeMarkets} tone="red" settled={displayStats.settled} />
          <HeroStat label="Your Balance" value={displayStats.balance} tone="amber" settled={displayStats.settled} />
          <HeroStat label="Your Rank" value={displayStats.rank} tone="green" settled={displayStats.settled} />
          <HeroStat label="Total Traded" value={displayStats.totalTraded} tone="dim" settled={displayStats.settled} />
        </div>
      </div>

      <section className="mx-auto max-w-[1200px] px-8 py-10">
        <div className="mb-6 flex items-baseline justify-between">
          <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
            🔥 Hot Right Now
          </span>
          <Link href="/markets/active" className="font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:text-[var(--text)]">
            View all markets →
          </Link>
        </div>
        <div className="carousel-wrap overflow-hidden">
          <div className="carousel-track gap-4 pb-2">
            {carouselItems.map((market, idx) => (
              <Link key={`${market.id}-${idx}`} href={`/market/${market.id}`} className="group relative block w-[300px] flex-shrink-0 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-5 transition-all hover:-translate-y-[1px]">
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

      <hr className="mx-8 border-0 border-t border-[var(--border)]" />

      <section className="mx-auto max-w-[1200px] px-8 py-10">
        <div className="mb-6 flex items-baseline justify-between">
          <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
            All Active Markets
          </span>
          <span className="font-mono text-[0.6rem] text-[var(--text-muted)]">{activeMarkets.length} open</span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {activeMarkets.map((market) => (
            <Link
              key={market.id}
              href={`/market/${market.id}`}
              className="relative block overflow-hidden rounded-[6px] border border-[var(--border)] border-l-2 border-l-transparent bg-[var(--surface)] px-6 py-5 transition-[background,border-color] hover:border-[var(--border2)] hover:border-l-[var(--red)] hover:bg-[var(--surface2)]"
            >
              <p className="mb-3 text-[0.87rem] font-medium leading-[1.4] text-[var(--text)]">
                {market.question}
              </p>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[0.55rem] uppercase tracking-[0.07em] text-[var(--text-muted)]">{shortTag(market)}</span>
                <span className={`font-mono text-[1.2rem] font-bold tracking-[-0.03em] ${probabilityClass(Number(market.probability || 0))}`}>
                  {Math.round(Number(market.probability || 0) * 100)}%
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <hr className="mx-8 border-0 border-t border-[var(--border)]" />

      <section className="mx-auto max-w-[1200px] px-8 py-10">
        <div className="mb-6 flex items-baseline justify-between">
          <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
            Recently Resolved
          </span>
          <Link href="/markets/inactive" className="font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:text-[var(--text)]">
            View all →
          </Link>
        </div>
        <div className="flex flex-col gap-[1px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--border)]">
          {resolvedMarkets.slice(0, 5).map((market) => (
            <Link key={market.id} href={`/market/${market.id}`} className="flex items-center gap-4 bg-[var(--surface)] px-5 py-3 transition-colors hover:bg-[var(--surface2)]">
              <span className="text-sm">{market.resolution === 'YES' ? '✅' : '❌'}</span>
              <span className="flex-1 text-[0.82rem] font-medium text-[var(--text-dim)]">{market.question}</span>
              <span className={`rounded px-2 py-1 font-mono text-[0.58rem] font-bold uppercase tracking-[0.06em] ${market.resolution === 'YES' ? 'border border-[rgba(22,163,74,.2)] bg-[rgba(22,163,74,.12)] text-[var(--green-bright)]' : 'border border-[rgba(220,38,38,.2)] bg-[var(--red-glow)] text-[var(--red)]'}`}>
                {market.resolution}
              </span>
              <span className="whitespace-nowrap font-mono text-[0.58rem] text-[var(--text-muted)]">{asDateLabel(market.resolvedAt)}</span>
            </Link>
          ))}
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1200px] items-center justify-between border-t border-[var(--border)] px-8 py-6">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Predict Cornell · BETA · Spring 2025</span>
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
