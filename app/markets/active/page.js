'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import MutedTrendBackground from '@/app/components/MutedTrendBackground';
import { CATEGORIES } from '@/utils/categorize';

const SORT_OPTIONS = [
  { id: 'newest',    label: 'Newest' },
  { id: 'active',    label: 'Most Active' },
  { id: 'prob-high', label: 'Prob: High → Low' },
  { id: 'prob-low',  label: 'Prob: Low → High' },
  { id: 'toss-up',   label: 'Toss-Up' },
];

function ActiveMarketsContent() {
  const [markets, setMarkets] = useState([]);
  const [trendSeriesByMarket, setTrendSeriesByMarket] = useState({});
  const [betCountByMarket, setBetCountByMarket] = useState({});
  const [activeCategory, setActiveCategory] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const sortedFilteredMarkets = useMemo(() => {
    let result = activeCategory === 'all'
      ? markets
      : markets.filter((m) => (m.category || 'wildcard') === activeCategory);

    return [...result].sort((a, b) => {
      switch (sortBy) {
        case 'active':
          return (betCountByMarket[b.id] || 0) - (betCountByMarket[a.id] || 0);
        case 'prob-high':
          return (b.probability || 0) - (a.probability || 0);
        case 'prob-low':
          return (a.probability || 0) - (b.probability || 0);
        case 'toss-up':
          return Math.abs((a.probability || 0.5) - 0.5) - Math.abs((b.probability || 0.5) - 0.5);
        default: { // 'newest'
          const aTime = a.createdAt?.toDate?.()?.getTime?.() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime?.() || 0;
          return bTime - aTime;
        }
      }
    });
  }, [activeCategory, sortBy, markets, betCountByMarket]);

  const selectedLabel = CATEGORIES.find((c) => c.id === activeCategory)?.label || 'All Markets';

  useEffect(() => {
    async function fetchMarkets() {
      try {
        setLoadError('');
        const q = query(
          collection(db, 'markets'),
          where('resolution', '==', null),
          where('marketplaceId', '==', null)
        );
        const snapshot = await getDocs(q);
        const marketData = snapshot.docs
          .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
          .filter((market) => !market.marketplaceId)
          .filter((market) => getMarketStatus(market) !== MARKET_STATUS.CANCELLED)
          .sort((a, b) => {
            const aTime = a.createdAt?.toDate?.()?.getTime?.() || 0;
            const bTime = b.createdAt?.toDate?.()?.getTime?.() || 0;
            return bTime - aTime;
          });
        setMarkets(marketData);

        const trendEntries = await Promise.all(
          marketData.map(async (market) => {
            const tradeQuery = query(
              collection(db, 'bets'),
              where('marketId', '==', market.id),
              where('marketplaceId', '==', null),
              orderBy('timestamp', 'desc')
            );
            const tradeSnapshot = await getDocs(tradeQuery);
            const count = tradeSnapshot.docs.length;
            const tradeProbabilities = tradeSnapshot.docs
              .map((snapshotDoc) => Number(snapshotDoc.data().probability))
              .filter((value) => Number.isFinite(value))
              .reverse();

            const initial = typeof market.initialProbability === 'number'
              ? market.initialProbability
              : (tradeProbabilities[0] ?? market.probability ?? 0.5);
            const series = tradeProbabilities.length > 0 ? [initial, ...tradeProbabilities] : [initial, initial];
            return [market.id, series, count];
          })
        );
        setTrendSeriesByMarket(Object.fromEntries(trendEntries.map(([id, series]) => [id, series])));
        setBetCountByMarket(Object.fromEntries(trendEntries.map(([id, , count]) => [id, count])));
      } catch (error) {
        console.error('Error fetching markets:', error);
        setLoadError('Unable to load active markets right now.');
      } finally {
        setLoading(false);
      }
    }
    fetchMarkets();
  }, []);

  if (loading) return <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">Loading...</div>;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-[var(--bg)] min-h-screen">
      {loadError && (
        <div className="mb-4 rounded border border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.08)] px-4 py-2 font-mono text-[0.65rem] text-[#f59e0b]">
          {loadError}
        </div>
      )}
      <h1 className="text-3xl font-bold mb-2 text-white">Active Markets</h1>
      <p className="text-white opacity-90 mb-6">
        {sortedFilteredMarkets.length} markets currently open or locked
        {activeCategory !== 'all' ? ` · ${selectedLabel}` : ''}
      </p>

      {/* Category filter — desktop pills */}
      <div className="hidden md:flex items-center gap-2 mb-4 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`
              px-4 py-1.5 rounded-full font-mono text-[0.65rem] uppercase tracking-[0.08em]
              border transition-colors
              ${activeCategory === cat.id
                ? 'bg-[var(--red)] border-[var(--red)] text-white'
                : 'bg-transparent border-[var(--border2)] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]'}
            `}
          >
            {cat.emoji} {cat.label}
          </button>
        ))}
      </div>

      {/* Sort controls — desktop pills */}
      <div className="hidden md:flex items-center gap-2 mb-6 flex-wrap">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">Sort:</span>
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setSortBy(opt.id)}
            className={`
              px-4 py-1.5 rounded-full font-mono text-[0.65rem] uppercase tracking-[0.08em]
              border transition-colors
              ${sortBy === opt.id
                ? 'bg-[var(--red)] border-[var(--red)] text-white'
                : 'bg-transparent border-[var(--border2)] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]'}
            `}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Category filter — mobile select */}
      <div className="md:hidden mb-3">
        <select
          value={activeCategory}
          onChange={(e) => setActiveCategory(e.target.value)}
          className="
            w-full bg-[var(--surface)] border border-[var(--border2)]
            text-[var(--text)] font-mono text-[0.75rem]
            px-4 py-3 rounded-[4px]
            appearance-none
          "
          style={{ fontSize: '16px' }}
        >
          {CATEGORIES.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.emoji} {cat.label}
            </option>
          ))}
        </select>
      </div>

      {/* Sort controls — mobile select */}
      <div className="md:hidden mb-6">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="
            w-full bg-[var(--surface)] border border-[var(--border2)]
            text-[var(--text)] font-mono text-[0.75rem]
            px-4 py-3 rounded-[4px]
            appearance-none
          "
          style={{ fontSize: '16px' }}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {markets.length === 0 ? (
        <div className="text-center py-12 bg-[var(--surface)] border-2 border-[var(--border)] rounded-lg">
          <p className="text-[var(--text-muted)]">No active markets right now.</p>
        </div>
      ) : sortedFilteredMarkets.length === 0 ? (
        <div className="text-center py-12 bg-[var(--surface)] border-2 border-[var(--border)] rounded-lg">
          <p className="text-[var(--text-muted)]">No {selectedLabel} markets right now.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sortedFilteredMarkets.map((market) => {
            const status = getMarketStatus(market);
            return (
              <Link key={market.id} href={`/market/${market.id}`} className="block group">
                <div className="relative bg-[var(--surface)] rounded-lg border border-[var(--border)] hover:border-brand-pink hover:shadow-lg transition-all duration-200 p-6 h-full overflow-hidden">
                  <MutedTrendBackground series={trendSeriesByMarket[market.id]} probability={market.probability} />
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-[var(--text)] group-hover:text-brand-red transition-colors min-h-[60px] relative z-10">
                      {market.question}
                    </h2>
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${status === MARKET_STATUS.LOCKED ? 'bg-[rgba(217,119,6,0.12)] text-[#f59e0b]' : 'bg-[rgba(34,197,94,0.12)] text-[#22c55e]'}`}>
                      {status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between mb-2 relative z-10">
                    <span className="text-sm font-medium text-[var(--text-muted)]">Probability</span>
                    <span className="text-3xl font-bold text-brand-red">
                      {typeof market.probability === 'number' ? `${Math.round(market.probability * 100)}%` : 'N/A'}
                    </span>
                  </div>

                  {typeof market.probability === 'number' && (
                    <div className="w-full bg-[var(--surface3)] rounded-full h-2 relative z-10">
                      <div
                        className="h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.max(0, Math.min(100, market.probability * 100))}%`,
                          background: market.probability > 0.65
                            ? 'var(--green-bright, #22c55e)'
                            : market.probability < 0.35
                              ? 'var(--red, #DC2626)'
                              : 'var(--amber-bright, #f59e0b)'
                        }}
                      />
                    </div>
                  )}

                  <div className="mt-4 text-sm text-brand-red font-medium group-hover:underline relative z-10">View market →</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ActiveMarketsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">
          Loading...
        </div>
      }
    >
      <ActiveMarketsContent />
    </Suspense>
  );
}
