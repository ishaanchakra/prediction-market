'use client';
import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';

export default function ResolvedMarketsPage() {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMarkets() {
      try {
        const q = query(
          collection(db, 'markets'),
          where('resolution', '!=', null),
          orderBy('resolvedAt', 'desc')
        );
        const snapshot = await getDocs(q);
        const marketData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setMarkets(marketData);
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
      <h1 className="text-3xl font-bold mb-2 text-white">Resolved Markets</h1>
      <p className="text-white opacity-90 mb-8">{markets.length} markets have been resolved</p>

      {markets.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg">
          <p className="text-gray-500">No resolved markets yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {markets.map((market) => (
            <Link
              key={market.id}
              href={`/market/${market.id}`}
              className="block group"
            >
              <div className="bg-white rounded-lg border-2 border-gray-200 hover:border-brand-pink hover:shadow-lg transition-all duration-200 p-6 h-full">
                <div className="flex items-start justify-between mb-3">
                  <h2 className="text-lg font-semibold text-gray-900 flex-1 min-h-[60px]">
                    {market.question}
                  </h2>
                  <span className="text-3xl ml-3">
                    {market.resolution === 'YES' ? '✅' : '❌'}
                  </span>
                </div>

                <div className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
                  market.resolution === 'YES' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-red-100 text-red-800'
                }`}>
                  Resolved: {market.resolution}
                </div>

                <p className="text-xs text-gray-500 mt-3">
                  {market.resolvedAt?.toDate?.()?.toLocaleDateString() || 'Recently'}
                </p>

                <div className="mt-4 text-sm text-brand-red font-medium group-hover:underline">
                  View details →
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}