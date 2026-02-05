'use client';
import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';

export default function Home() {
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
    <div className="min-h-screen bg-eggshell">
      <div className="max-w-6xl mx-auto p-8">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-carnelian mb-2">
            Cornell Prediction Markets
          </h1>
          <p className="text-gray-600">
            Forecast campus events. Build your reputation. Prove you know what's coming.
          </p>
        </div>

        {markets.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No active markets yet. Check back soon!</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {markets.map((market) => (
              <Link
                key={market.id}
                href={`/market/${market.id}`}
                className="block group"
              >
                <div className="bg-cream rounded-lg border-2 border-carnelian hover:shadow-xl transition-all duration-200 overflow-hidden h-full">
                  <div className="p-6">
                    <h2 className="text-lg font-semibold text-gray-900 group-hover:text-carnelian transition-colors mb-4 min-h-[60px]">
                      {market.question}
                    </h2>

                    <div className="mt-auto">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-600">Probability</span>
                        <span className="text-3xl font-bold text-carnelian">
                          {typeof market.probability === 'number' 
                            ? `${Math.round(market.probability * 100)}%` 
                            : 'N/A'}
                        </span>
                      </div>

                      {typeof market.probability === 'number' && (
                        <div className="mt-3">
                          <div className="w-full bg-gray-200 rounded-full h-3">
                            <div 
                              className="bg-carnelian h-3 rounded-full transition-all duration-300"
                              style={{ width: `${market.probability * 100}%` }}
                            ></div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex items-center text-sm text-carnelian font-medium">
                      <span className="group-hover:underline">View market →</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}