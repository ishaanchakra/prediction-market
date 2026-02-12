'use client';
import { useEffect, useMemo, useState } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import Link from 'next/link';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';

function mergeMarkets(primary, secondary) {
  const map = new Map();
  [...primary, ...secondary].forEach((market) => map.set(market.id, market));
  return Array.from(map.values());
}

export default function Home() {
  const [activeMarkets, setActiveMarkets] = useState([]);
  const [closedMarkets, setClosedMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  const carouselMarkets = useMemo(() => [...activeMarkets, ...activeMarkets], [activeMarkets]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function fetchMarkets() {
      try {
        const activeQuery = query(collection(db, 'markets'), where('resolution', '==', null));
        const activeSnapshot = await getDocs(activeQuery);
        const activeData = activeSnapshot.docs
          .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
          .filter((market) => getMarketStatus(market) !== MARKET_STATUS.CANCELLED)
          .sort((a, b) => {
            const aTime = a.createdAt?.toDate?.()?.getTime?.() || 0;
            const bTime = b.createdAt?.toDate?.()?.getTime?.() || 0;
            return bTime - aTime;
          });
        setActiveMarkets(activeData);

        const resolvedQuery = query(collection(db, 'markets'), where('resolution', '!=', null), orderBy('resolvedAt', 'desc'), limit(6));
        const cancelledQuery = query(collection(db, 'markets'), where('status', '==', MARKET_STATUS.CANCELLED), orderBy('cancelledAt', 'desc'), limit(6));
        const [resolvedSnapshot, cancelledSnapshot] = await Promise.all([getDocs(resolvedQuery), getDocs(cancelledQuery)]);

        const resolvedData = resolvedSnapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
        const cancelledData = cancelledSnapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));

        setClosedMarkets(
          mergeMarkets(resolvedData, cancelledData)
            .sort((a, b) => {
              const aTime = a.resolvedAt?.toDate?.()?.getTime?.() || a.cancelledAt?.toDate?.()?.getTime?.() || 0;
              const bTime = b.resolvedAt?.toDate?.()?.getTime?.() || b.cancelledAt?.toDate?.()?.getTime?.() || 0;
              return bTime - aTime;
            })
            .slice(0, 6)
        );
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
      <div className="min-h-screen flex items-center justify-center bg-brand-red dark:bg-slate-950">
        <div className="text-white text-xl">Loading markets...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-red dark:bg-slate-950">
      {!user && (
        <div className="bg-gradient-to-br from-brand-red via-brand-darkred to-brand-pink dark:from-slate-900 dark:via-slate-800 dark:to-slate-700 text-white">
          <div className="max-w-6xl mx-auto px-6 py-20 text-center">
            <h1 className="text-6xl font-black mb-6 leading-tight">
              Bear or Bull?<br />Make Your Call.
            </h1>
            <p className="text-2xl mb-8 opacity-95 max-w-3xl mx-auto">
              Trade on campus events, compete with classmates, and prove you know what&apos;s coming next.
            </p>
            <div className="flex gap-4 justify-center">
              <Link href="/login" className="bg-white text-brand-red px-8 py-4 rounded-xl font-bold text-lg hover:bg-gray-100 transition-all shadow-xl hover:scale-105">
                Get Started for Free
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

      <div id="markets" className="max-w-7xl mx-auto px-6 py-16">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-4xl font-bold text-white mb-2">Active Markets</h2>
            <p className="text-white opacity-90 text-lg">
              {activeMarkets.length} live markets • {user ? 'Trade now' : 'Sign in to trade'}
            </p>
          </div>
          <Link href="/markets/active" className="text-white font-semibold underline">
            View all →
          </Link>
        </div>

        {activeMarkets.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-2xl border-2 border-gray-200 dark:border-slate-700">
            <div className="text-6xl mb-4">📊</div>
            <p className="text-xl text-gray-500 dark:text-gray-300 font-semibold">No active markets yet</p>
          </div>
        ) : (
          <div className="carousel-wrap overflow-hidden rounded-2xl border-2 border-white/20 py-2">
            <div className="carousel-track gap-4 px-2">
              {carouselMarkets.map((market, idx) => (
                <Link key={`${market.id}-${idx}`} href={`/market/${market.id}`} className="block min-w-[320px] max-w-[320px] group">
                  <MarketCard market={market} isActive canTrade={!!user} />
                </Link>
              ))}
            </div>
          </div>
        )}

        {!user && activeMarkets.length > 0 && (
          <div className="text-center mt-12 p-8 bg-brand-darkred dark:bg-slate-800 rounded-2xl border-2 border-brand-pink dark:border-slate-600">
            <p className="text-xl font-semibold text-white mb-4">Ready to start trading?</p>
            <Link href="/login" className="inline-block bg-white text-brand-red px-8 py-3 rounded-xl font-bold text-lg hover:bg-gray-100 transition-all shadow-lg">
              Create Account - It&apos;s Free
            </Link>
          </div>
        )}
      </div>

      {closedMarkets.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border-t-2 border-brand-pink dark:border-slate-700">
          <div className="max-w-7xl mx-auto px-6 py-16">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-2">Closed Markets</h2>
                <p className="text-gray-600 dark:text-gray-300 text-lg">Resolved and archived outcomes</p>
              </div>
              <Link href="/markets/inactive" className="text-brand-red dark:text-brand-lightpink font-semibold">
                View all →
              </Link>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {closedMarkets.map((market) => (
                <Link key={market.id} href={`/market/${market.id}`} className="block group">
                  <MarketCard market={market} isActive={false} canTrade={!!user} />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MarketCard({ market, isActive, canTrade }) {
  const status = getMarketStatus(market);
  return (
    <div
      className={`bg-white dark:bg-slate-900 rounded-xl border-2 transition-all duration-200 p-6 h-full ${
        isActive ? 'border-gray-200 dark:border-slate-700 hover:border-brand-pink hover:shadow-xl' : 'border-gray-300 dark:border-slate-700'
      } ${!canTrade && isActive ? 'relative' : ''}`}
    >
      {!canTrade && isActive && (
        <div className="absolute top-4 right-4 bg-brand-red text-white text-xs font-bold px-3 py-1 rounded-full">Login to trade</div>
      )}

      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 min-h-[60px] leading-tight">{market.question}</h3>
        <span className="px-2 py-1 rounded-full text-xs font-bold bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200">{status}</span>
      </div>

      {isActive ? (
        <>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Probability</span>
            <span className="text-4xl font-black text-brand-red">
              {typeof market.probability === 'number' ? `${Math.round(market.probability * 100)}%` : 'N/A'}
            </span>
          </div>

          {typeof market.probability === 'number' && (
            <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-3 mb-4">
              <div className="bg-brand-red h-3 rounded-full transition-all duration-500" style={{ width: `${market.probability * 100}%` }} />
            </div>
          )}
        </>
      ) : status === MARKET_STATUS.CANCELLED ? (
        <div className="inline-block px-3 py-1 rounded-full text-sm font-bold bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 mb-3">Cancelled + Refunded</div>
      ) : (
        <div className={`inline-block px-3 py-1 rounded-full text-sm font-bold mb-3 ${market.resolution === 'YES' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          Resolved: {market.resolution}
        </div>
      )}

      <div className="text-brand-red font-bold text-sm group-hover:underline">{isActive ? 'Trade now →' : 'View details →'}</div>
    </div>
  );
}
