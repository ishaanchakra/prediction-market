'use client';
import { useEffect, useMemo, useState } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import MutedTrendBackground from '@/app/components/MutedTrendBackground';
import { CATEGORIES } from '@/utils/categorize';

function mergeMarkets(primary, secondary) {
  const map = new Map();
  [...primary, ...secondary].forEach((market) => map.set(market.id, market));
  return Array.from(map.values()).sort((a, b) => {
    const aTime = a.resolvedAt?.toDate?.()?.getTime?.() || a.cancelledAt?.toDate?.()?.getTime?.() || 0;
    const bTime = b.resolvedAt?.toDate?.()?.getTime?.() || b.cancelledAt?.toDate?.()?.getTime?.() || 0;
    return bTime - aTime;
  });
}

export default function ClosedMarketsPage() {
  const [markets, setMarkets] = useState([]);
  const [trendSeriesByMarket, setTrendSeriesByMarket] = useState({});
  const [activeCategory, setActiveCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const filteredMarkets = useMemo(
    () => (activeCategory === 'all'
      ? markets
      : markets.filter((market) => (market.category || 'wildcard') === activeCategory)),
    [activeCategory, markets]
  );

  useEffect(() => {
    async function fetchMarkets() {
      try {
        setLoadError('');
        const resolvedQuery = query(collection(db, 'markets'), where('resolution', '!=', null), orderBy('resolvedAt', 'desc'), limit(100));
        const cancelledQuery = query(collection(db, 'markets'), where('status', '==', MARKET_STATUS.CANCELLED), orderBy('cancelledAt', 'desc'), limit(100));

        const [resolvedSnapshot, cancelledSnapshot] = await Promise.all([getDocs(resolvedQuery), getDocs(cancelledQuery)]);

        const resolvedData = resolvedSnapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
        const cancelledData = cancelledSnapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));

        const marketData = mergeMarkets(resolvedData, cancelledData);
        setMarkets(marketData);

        const trendEntries = await Promise.all(
          marketData.map(async (market) => {
            const tradeQuery = query(
              collection(db, 'bets'),
              where('marketId', '==', market.id),
              orderBy('timestamp', 'asc')
            );
            const tradeSnapshot = await getDocs(tradeQuery);
            const tradeProbabilities = tradeSnapshot.docs
              .map((snapshotDoc) => Number(snapshotDoc.data().probability))
              .filter((value) => Number.isFinite(value));

            const initial = typeof market.initialProbability === 'number'
              ? market.initialProbability
              : (tradeProbabilities[0] ?? market.probability ?? 0.5);
            const series = tradeProbabilities.length > 0 ? [initial, ...tradeProbabilities] : [initial, initial];
            return [market.id, series];
          })
        );
        setTrendSeriesByMarket(Object.fromEntries(trendEntries));
      } catch (error) {
        console.error('Error fetching markets:', error);
        setLoadError('Unable to load closed markets right now.');
      } finally {
        setLoading(false);
      }
    }
    fetchMarkets();
  }, []);

  if (loading) return <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">Loading...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto bg-[var(--bg)] min-h-screen">
      {loadError && (
        <div className="mb-4 rounded border border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.08)] px-4 py-2 font-mono text-[0.65rem] text-[#f59e0b]">
          {loadError}
        </div>
      )}
      <h1 className="mb-2 font-sans text-3xl font-extrabold text-[var(--text)]">Closed Markets</h1>
      <p className="mb-8 text-[var(--text-dim)]">{markets.length} closed markets</p>

      <div className="hidden md:flex items-center gap-2 mb-6 flex-wrap">
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
      <div className="md:hidden mb-6">
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

      {markets.length === 0 ? (
        <div className="text-center py-12 bg-[var(--surface)] border-2 border-[var(--border)] rounded-lg">
          <p className="text-[var(--text-muted)]">No closed markets yet.</p>
        </div>
      ) : filteredMarkets.length === 0 ? (
        <div className="col-span-full py-16 text-center font-mono text-[0.75rem] text-[var(--text-muted)]">
          No {activeCategory === 'all' ? '' : CATEGORIES.find((c) => c.id === activeCategory)?.label} markets yet.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredMarkets.map((market) => {
            const status = getMarketStatus(market);
            const isCancelled = status === MARKET_STATUS.CANCELLED;
            return (
              <Link key={market.id} href={`/market/${market.id}`} className="block group">
                <div className="relative h-full overflow-hidden rounded-lg border-2 border-[var(--border)] bg-[var(--surface)] p-6 transition-all duration-200 hover:border-[var(--border2)] hover:shadow-lg">
                  <MutedTrendBackground series={trendSeriesByMarket[market.id]} probability={market.probability} />
                  <div className="flex items-start justify-between mb-3">
                    <h2 className="text-lg font-semibold text-[var(--text)] flex-1 min-h-[60px] relative z-10">{market.question}</h2>
                    <span className="relative z-10 ml-3 rounded-[3px] bg-[var(--surface2)] px-2 py-1 text-xs font-bold text-[var(--text-dim)]">{status}</span>
                  </div>

                  {!isCancelled ? (
                    <div className={`relative z-10 inline-block rounded-[3px] px-3 py-1 text-sm font-semibold ${market.resolution === 'YES' ? 'border border-[rgba(22,163,74,0.2)] bg-[rgba(22,163,74,0.1)] text-[var(--green-bright)]' : 'border border-[rgba(220,38,38,0.2)] bg-[var(--red-glow)] text-[var(--red)]'}`}>
                      Resolved: {market.resolution}
                    </div>
                  ) : (
                    <div className="relative z-10 inline-block rounded-[3px] bg-[var(--surface2)] px-3 py-1 text-sm font-semibold text-[var(--text-dim)]">Cancelled + Refunded</div>
                  )}

                  <p className="text-xs text-[var(--text-muted)] mt-3 relative z-10">
                    {market.resolvedAt?.toDate?.()?.toLocaleDateString() || market.cancelledAt?.toDate?.()?.toLocaleDateString() || 'Recently'}
                  </p>

                  <div className="relative z-10 mt-4 text-sm font-medium text-[var(--red)] group-hover:underline">View details →</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
