'use client';
import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMarkets() {
      try {
        const resolvedQuery = query(collection(db, 'markets'), where('resolution', '!=', null), orderBy('resolvedAt', 'desc'), limit(100));
        const cancelledQuery = query(collection(db, 'markets'), where('status', '==', MARKET_STATUS.CANCELLED), orderBy('cancelledAt', 'desc'), limit(100));

        const [resolvedSnapshot, cancelledSnapshot] = await Promise.all([getDocs(resolvedQuery), getDocs(cancelledQuery)]);

        const resolvedData = resolvedSnapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
        const cancelledData = cancelledSnapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));

        setMarkets(mergeMarkets(resolvedData, cancelledData));
      } catch (error) {
        console.error('Error fetching markets:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchMarkets();
  }, []);

  if (loading) return <div className="p-8 bg-brand-red text-white">Loading...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto bg-brand-red min-h-screen">
      <h1 className="text-3xl font-bold mb-2 text-white">Closed Markets</h1>
      <p className="text-white opacity-90 mb-8">{markets.length} closed markets</p>

      {markets.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg">
          <p className="text-gray-500">No closed markets yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {markets.map((market) => {
            const status = getMarketStatus(market);
            const isCancelled = status === MARKET_STATUS.CANCELLED;
            return (
              <Link key={market.id} href={`/market/${market.id}`} className="block group">
                <div className="bg-white rounded-lg border-2 border-gray-200 hover:border-brand-pink hover:shadow-lg transition-all duration-200 p-6 h-full">
                  <div className="flex items-start justify-between mb-3">
                    <h2 className="text-lg font-semibold text-gray-900 flex-1 min-h-[60px]">{market.question}</h2>
                    <span className="ml-3 px-2 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700">{status}</span>
                  </div>

                  {!isCancelled ? (
                    <div className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${market.resolution === 'YES' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      Resolved: {market.resolution}
                    </div>
                  ) : (
                    <div className="inline-block px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 text-gray-700">Cancelled + Refunded</div>
                  )}

                  <p className="text-xs text-gray-500 mt-3">
                    {market.resolvedAt?.toDate?.()?.toLocaleDateString() || market.cancelledAt?.toDate?.()?.toLocaleDateString() || 'Recently'}
                  </p>

                  <div className="mt-4 text-sm text-brand-red font-medium group-hover:underline">View details →</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
