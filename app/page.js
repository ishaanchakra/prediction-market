'use client';
import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';

console.log("Database object:", db); // ADD THIS LINE

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
        console.log('Fetched markets:', marketData); // DEBUG
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
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Active Markets</h1>
      {markets.length === 0 ? (
        <p className="text-gray-500">No active markets yet.</p>
      ) : (
        <div className="grid gap-4">
          {markets.map((market) => {
            console.log("Market ID:", market.id);
            console.log("Full market data:", market);
            return (
              <Link
                key={market.id}
                href={`/market/${market.id}`}
                className="block group"
              >
                <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow duration-200 overflow-hidden h-full border">
                  <div className="p-6">
                    <h2 className="text-lg font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors mb-4">
                      {market.question}
                    </h2>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-500">Probability</span>
                      <span className="text-2xl font-bold text-indigo-600">
                        {typeof market.probability === 'number' 
                          ? `${Math.round(market.probability * 100)}%` 
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="mt-4 text-sm text-gray-500">
                      View details →
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}