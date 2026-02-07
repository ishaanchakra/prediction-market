'use client';
import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import Link from 'next/link';

export default function Home() {
  const [activeMarkets, setActiveMarkets] = useState([]);
  const [resolvedMarkets, setResolvedMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function fetchMarkets() {
      try {
        // Fetch active markets
        const activeQuery = query(
          collection(db, 'markets'),
          where('resolution', '==', null)
        );
        const activeSnapshot = await getDocs(activeQuery);
        const activeData = activeSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setActiveMarkets(activeData);

        // Fetch recently resolved markets (limit 6)
        const resolvedQuery = query(
          collection(db, 'markets'),
          where('resolution', '!=', null),
          orderBy('resolvedAt', 'desc'),
          limit(6)
        );
        const resolvedSnapshot = await getDocs(resolvedQuery);
        const resolvedData = resolvedSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setResolvedMarkets(resolvedData);
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
      <div className="min-h-screen flex items-center justify-center bg-brand-red">
        <div className="text-white text-xl">Loading markets...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-red">
      {/* Hero Section - Only for logged out users */}
      {!user && (
        <div className="bg-gradient-to-br from-brand-red via-brand-darkred to-brand-pink text-white">
          <div className="max-w-6xl mx-auto px-6 py-20 text-center">
            <h1 className="text-6xl font-black mb-6 leading-tight">
              Bear or Bull?<br />Make Your Call.
            </h1>
            <p className="text-2xl mb-8 opacity-95 max-w-3xl mx-auto">
              Trade on campus events, compete with classmates, and prove you know what's coming next.
            </p>
            <div className="flex gap-4 justify-center">
              <Link
                href="/login"
                className="bg-white text-brand-red px-8 py-4 rounded-xl font-bold text-lg hover:bg-gray-100 transition-all shadow-xl hover:scale-105"
              >
                Get Started Free
              </Link>
              <button
                onClick={() => document.getElementById('markets')?.scrollIntoView({ behavior: 'smooth' })}
                className="border-2 border-white text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-white hover:text-brand-red transition-all"
              >
                See Markets
              </button>
            </div>
            <p className="text-sm mt-6 opacity-80">@cornell.edu email required</p>
          </div>
        </div>
      )}

      {/* Active Markets Section */}
      <div id="markets" className="max-w-7xl mx-auto px-6 py-16">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-4xl font-bold text-white mb-2">
              🔥 Active Markets
            </h2>
            <p className="text-white opacity-90 text-lg">
              {activeMarkets.length} live markets • {user ? 'Trade now' : 'Sign in to trade'}
            </p>
          </div>
          {user && (
            <Link
              href="/markets/active"
              className="text-brand-pink hover:text-brand-lightpink font-semibold"
            >
              View all →
            </Link>
          )}
        </div>

        {activeMarkets.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border-2 border-gray-200">
            <div className="text-6xl mb-4">📊</div>
            <p className="text-xl text-gray-500 font-semibold">No active markets yet</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {activeMarkets.slice(0, 6).map((market) => (
              <MarketCard key={market.id} market={market} isActive={true} canTrade={!!user} />
            ))}
          </div>
        )}

        {!user && activeMarkets.length > 0 && (
          <div className="text-center mt-12 p-8 bg-brand-darkred rounded-2xl border-2 border-brand-pink">
            <p className="text-xl font-semibold text-white mb-4">
              Ready to start trading?
            </p>
            <Link
              href="/login"
              className="inline-block bg-white text-brand-red px-8 py-3 rounded-xl font-bold text-lg hover:bg-gray-100 transition-all shadow-lg"
            >
              Create Account - It's Free
            </Link>
          </div>
        )}
      </div>

      {/* Recently Resolved Markets */}
      {resolvedMarkets.length > 0 && (
        <div className="bg-white border-t-2 border-brand-pink">
          <div className="max-w-7xl mx-auto px-6 py-16">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-4xl font-bold text-gray-900 mb-2">
                  ✅ Recently Resolved
                </h2>
                <p className="text-gray-600 text-lg">
                  See how the markets played out
                </p>
              </div>
              {user && (
                <Link
                  href="/markets/resolved"
                  className="text-brand-red hover:text-brand-darkred font-semibold"
                >
                  View all →
                </Link>
              )}
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {resolvedMarkets.map((market) => (
                <MarketCard key={market.id} market={market} isActive={false} canTrade={!!user} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MarketCard({ market, isActive, canTrade }) {
  const content = (
    <div className={`bg-white rounded-xl border-2 transition-all duration-200 p-6 h-full ${
      isActive 
        ? 'border-gray-200 hover:border-brand-pink hover:shadow-xl' 
        : 'border-gray-300'
    } ${!canTrade && isActive ? 'relative' : ''}`}>
      {!canTrade && isActive && (
        <div className="absolute top-4 right-4 bg-brand-red text-white text-xs font-bold px-3 py-1 rounded-full">
          Login to trade
        </div>
      )}

      {!isActive && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-3xl">{market.resolution === 'YES' ? '✅' : '❌'}</span>
          <span className={`px-3 py-1 rounded-full text-sm font-bold ${
            market.resolution === 'YES' 
              ? 'bg-green-100 text-green-800' 
              : 'bg-red-100 text-red-800'
          }`}>
            Resolved: {market.resolution}
          </span>
        </div>
      )}
      
      <h3 className="text-lg font-bold text-gray-900 mb-4 min-h-[60px] leading-tight">
        {market.question}
      </h3>

      {isActive && (
        <>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Probability
            </span>
            <span className="text-4xl font-black text-brand-red">
              {typeof market.probability === 'number' 
                ? `${Math.round(market.probability * 100)}%` 
                : 'N/A'}
            </span>
          </div>

          {typeof market.probability === 'number' && (
            <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
              <div 
                className="bg-brand-red h-3 rounded-full transition-all duration-500"
                style={{ width: `${market.probability * 100}%` }}
              ></div>
            </div>
          )}
        </>
      )}

      <div className="text-brand-red font-bold text-sm group-hover:underline">
        {isActive ? 'Trade now →' : 'View details →'}
      </div>
    </div>
  );

  // Always make it clickable, regardless of login status
  return (
    <Link href={`/market/${market.id}`} className="block group">
      {content}
    </Link>
  );
}