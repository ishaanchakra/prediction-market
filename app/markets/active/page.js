'use client';
import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';

export default function ActiveMarketsPage() {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMarkets() {
      try {
        const q = query(
          collection(db, 'markets'),
          where('resolution', '==', null)
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

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Active Markets</h1>
      <p className="text-gray-600 mb-8">{markets.length} markets currently open for trading</p>

      {markets.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-500">No active markets right now.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {markets.map((market) => (
            <Link
              key={market.id}
              href={`/market/${market.id}`}
              className="block group"
            >
              <div className="bg-white rounded-lg border border-gray-200 hover:border-indigo-500 hover:shadow-lg transition-all duration-200 p-6 h-full">
                <h2 className="text-lg font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors mb-4 min-h-[60px]">
                  {market.question}
                </h2>

                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-500">Probability</span>
                  <span className="text-3xl font-bold text-indigo-600">
                    {typeof market.probability === 'number' 
                      ? `${Math.round(market.probability * 100)}%` 
                      : 'N/A'}
                  </span>
                </div>

                {typeof market.probability === 'number' && (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${market.probability * 100}%` }}
                    ></div>
                  </div>
                )}

                <div className="mt-4 text-sm text-indigo-600 font-medium group-hover:underline">
                  View market →
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}