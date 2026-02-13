'use client';
import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import MutedTrendBackground from '@/app/components/MutedTrendBackground';

export default function ActiveMarketsPage() {
  const [markets, setMarkets] = useState([]);
  const [trendSeriesByMarket, setTrendSeriesByMarket] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMarkets() {
      try {
        const q = query(collection(db, 'markets'), where('resolution', '==', null));
        const snapshot = await getDocs(q);
        const marketData = snapshot.docs
          .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
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
      } finally {
        setLoading(false);
      }
    }
    fetchMarkets();
  }, []);

  if (loading) return <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">Loading...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto bg-[var(--bg)] min-h-screen">
      <h1 className="text-3xl font-bold mb-2 text-white">Active Markets</h1>
      <p className="text-white opacity-90 mb-8">{markets.length} markets currently open or locked</p>

      {markets.length === 0 ? (
        <div className="text-center py-12 bg-[var(--surface)] border-2 border-[var(--border)] rounded-lg">
          <p className="text-[var(--text-muted)]">No active markets right now.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {markets.map((market) => {
            const status = getMarketStatus(market);
            return (
              <Link key={market.id} href={`/market/${market.id}`} className="block group">
                <div className="relative bg-[var(--surface)] rounded-lg border border-[var(--border)] hover:border-brand-pink hover:shadow-lg transition-all duration-200 p-6 h-full overflow-hidden">
                  <MutedTrendBackground series={trendSeriesByMarket[market.id]} probability={market.probability} />
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-[var(--text)] group-hover:text-brand-red transition-colors min-h-[60px] relative z-10">
                      {market.question}
                    </h2>
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${status === MARKET_STATUS.LOCKED ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
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
                      <div className="bg-[var(--bg)] h-2 rounded-full transition-all duration-300" style={{ width: `${market.probability * 100}%` }} />
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
