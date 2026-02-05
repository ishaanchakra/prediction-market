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

  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="text-carnelian text-xl font-bold">Loading markets...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-carnelian to-carnelian-dark text-white py-16 px-6">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-6xl font-black mb-4 tracking-tight">
            Predict Cornell
          </h1>
          <p className="text-2xl font-medium opacity-90 max-w-2xl mx-auto">
            Forecast campus events. Build your reputation. Win big. 🌽
          </p>
        </div>
      </div>

      {/* Markets Grid */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h2 className="text-3xl font-black text-gray-900 mb-2">
            Active Markets
          </h2>
          <p className="text-gray-600 text-lg">
            {markets.length} markets • Make your predictions now
          </p>
        </div>

        {markets.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border-2 border-gray-100">
            <div className="text-6xl mb-4">📊</div>
            <p className="text-xl text-gray-500 font-semibold">No active markets yet</p>
            <p className="text-gray-400 mt-2">Check back soon for new predictions!</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {markets.map((market) => (
              <Link
                key={market.id}
                href={`/market/${market.id}`}
                className="group"
              >
                <div className="bg-white rounded-2xl border-2 border-gray-100 hover:border-carnelian hover:shadow-xl transition-all duration-200 p-6 h-full">
                  <h3 className="text-xl font-bold text-gray-900 mb-6 min-h-[60px] leading-tight">
                    {market.question}
                  </h3>

                  <div className="space-y-4">
                    {/* Probability Display */}
                    <div className="flex items-end justify-between">
                      <span className="text-sm font-bold text-gray-500 uppercase tracking-wide">
                        Yes Chance
                      </span>
                      <span className="text-5xl font-black text-carnelian">
                        {typeof market.probability === 'number' 
                          ? `${Math.round(market.probability * 100)}%` 
                          : '—'}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    {typeof market.probability === 'number' && (
                      <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div 
                          className="bg-gradient-to-r from-carnelian to-carnelian-light h-3 rounded-full transition-all duration-500"
                          style={{ width: `${market.probability * 100}%` }}
                        />
                      </div>
                    )}

                    {/* CTA */}
                    <div className="pt-2">
                      <span className="text-carnelian font-bold group-hover:underline inline-flex items-center gap-2">
                        Trade now
                        <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </span>
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