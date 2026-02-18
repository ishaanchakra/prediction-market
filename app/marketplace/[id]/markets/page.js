'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import { fetchMarketplaceContext, fetchMarketplaceMarkets } from '@/utils/marketplaceClient';

function probabilityClass(probability) {
  if (probability > 0.65) return 'text-[var(--green-bright)]';
  if (probability < 0.35) return 'text-[var(--red)]';
  return 'text-[var(--amber-bright)]';
}

export default function MarketplaceMarketsPage() {
  const params = useParams();
  const router = useRouter();
  const marketplaceId = params?.id;

  const [tab, setTab] = useState('active');
  const [loading, setLoading] = useState(true);
  const [marketplace, setMarketplace] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [error, setError] = useState('');

  const filteredMarkets = useMemo(() => {
    if (tab === 'active') {
      return markets.filter((market) => {
        const status = getMarketStatus(market);
        return status === MARKET_STATUS.OPEN || status === MARKET_STATUS.LOCKED;
      });
    }
    return markets.filter((market) => {
      const status = getMarketStatus(market);
      return status === MARKET_STATUS.RESOLVED || status === MARKET_STATUS.CANCELLED;
    });
  }, [markets, tab]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }

      setLoading(true);
      try {
        setError('');
        const { marketplace: marketplaceDoc, membership } = await fetchMarketplaceContext(marketplaceId, currentUser.uid);
        if (!marketplaceDoc || marketplaceDoc.isArchived) {
          setError('Marketplace not found.');
          return;
        }
        if (!membership) {
          router.push(`/marketplace/enter?marketplace=${marketplaceId}`);
          return;
        }
        setMarketplace(marketplaceDoc);
        setMarkets(await fetchMarketplaceMarkets(marketplaceId));
      } catch (err) {
        console.error('Error loading marketplace markets:', err);
        setError('Unable to load marketplace markets right now.');
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [marketplaceId, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <p className="font-mono text-[var(--text-muted)]">Loading markets...</p>
      </div>
    );
  }

  if (!marketplace || error) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6">
        <p className="font-mono text-[var(--text-muted)]">{error || 'Marketplace unavailable.'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-8 md:px-8 md:py-10">
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-6 flex items-end justify-between border-b border-[var(--border)] pb-5">
          <div>
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
              <Link href={`/marketplace/${marketplaceId}`} className="text-[var(--text-dim)] hover:text-[var(--text)]">
                {marketplace.name}
              </Link>{' '}
              / Markets
            </p>
            <h1 className="mt-2 font-display text-[2rem] text-[var(--text)]">Marketplace Markets</h1>
          </div>
        </div>

        <div className="mb-5 flex border-b border-[var(--border)]">
          <button
            onClick={() => setTab('active')}
            className={`mb-[-1px] border-b-2 px-4 py-2 font-mono text-[0.65rem] uppercase tracking-[0.06em] ${
              tab === 'active' ? 'border-[var(--red)] text-[var(--text)]' : 'border-transparent text-[var(--text-muted)]'
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setTab('closed')}
            className={`mb-[-1px] border-b-2 px-4 py-2 font-mono text-[0.65rem] uppercase tracking-[0.06em] ${
              tab === 'closed' ? 'border-[var(--red)] text-[var(--text)]' : 'border-transparent text-[var(--text-muted)]'
            }`}
          >
            Closed
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {filteredMarkets.length === 0 ? (
            <div className="col-span-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-sm text-[var(--text-dim)]">
              No {tab === 'active' ? 'active' : 'closed'} markets yet.
            </div>
          ) : (
            filteredMarkets.map((market) => (
              <Link
                key={market.id}
                href={`/market/${market.id}`}
                className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4 hover:bg-[var(--surface2)]"
              >
                <p className="mb-3 text-sm font-medium text-[var(--text)]">{market.question}</p>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">{getMarketStatus(market)}</span>
                  <span className={`font-mono text-[1.15rem] font-bold ${probabilityClass(Number(market.probability || 0))}`}>
                    {Math.round(Number(market.probability || 0) * 100)}%
                  </span>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

