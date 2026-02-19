'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import ToastStack from '@/app/components/ToastStack';
import useToastQueue from '@/app/hooks/useToastQueue';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import { MARKETPLACE_ROLE } from '@/utils/marketplace';
import { buildMarketplaceInviteUrl } from '@/utils/marketplaceInvite';
import { fetchMarketplaceBets, fetchMarketplaceContext, fetchMarketplaceMarkets } from '@/utils/marketplaceClient';

function probabilityClass(probability) {
  if (probability > 0.65) return 'text-[var(--green-bright)]';
  if (probability < 0.35) return 'text-[var(--red)]';
  return 'text-[var(--amber-bright)]';
}

export default function MarketplaceDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const { toasts, notifyError, notifySuccess, removeToast, resolveConfirm } = useToastQueue();
  const marketplaceId = params?.id;

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [marketplace, setMarketplace] = useState(null);
  const [membership, setMembership] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [volumeByMarket, setVolumeByMarket] = useState({});
  const [error, setError] = useState('');

  const isCreator = membership?.role === MARKETPLACE_ROLE.CREATOR;

  const stats = useMemo(() => {
    const activeMarkets = markets.filter((market) => {
      const status = getMarketStatus(market);
      return status === MARKET_STATUS.OPEN || status === MARKET_STATUS.LOCKED;
    });
    const averageProbability = activeMarkets.length
      ? activeMarkets.reduce((sum, market) => sum + Number(market.probability || 0), 0) / activeMarkets.length
      : 0;

    let highestConviction = null;
    activeMarkets.forEach((market) => {
      const conviction = Math.abs(Number(market.probability || 0.5) - 0.5);
      if (!highestConviction || conviction > highestConviction.conviction) {
        highestConviction = { market, conviction };
      }
    });

    let topVolume = null;
    activeMarkets.forEach((market) => {
      const volume = Number(volumeByMarket[market.id] || 0);
      if (!topVolume || volume > topVolume.volume) {
        topVolume = { market, volume };
      }
    });

    return {
      activeCount: activeMarkets.length,
      averageProbability,
      highestConviction,
      topVolume
    };
  }, [markets, volumeByMarket]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }
      setUser(currentUser);
      setLoading(true);

      try {
        setError('');
        const context = await fetchMarketplaceContext(marketplaceId, currentUser.uid);
        if (!context.marketplace || context.marketplace.isArchived) {
          setError('Marketplace not found.');
          return;
        }
        if (!context.membership) {
          router.push(`/marketplace/enter?marketplace=${marketplaceId}`);
          return;
        }

        setMarketplace(context.marketplace);
        setMembership(context.membership);

        const [marketRows, betRows] = await Promise.all([
          fetchMarketplaceMarkets(marketplaceId),
          fetchMarketplaceBets(marketplaceId)
        ]);
        setMarkets(marketRows);

        const volumes = {};
        betRows.forEach((bet) => {
          volumes[bet.marketId] = Number(volumes[bet.marketId] || 0) + Math.abs(Number(bet.amount || 0));
        });
        setVolumeByMarket(volumes);
      } catch (err) {
        console.error('Error loading marketplace dashboard:', err);
        setError('Unable to load this marketplace right now.');
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [marketplaceId, router]);

  async function handleShareMarketplace() {
    if (typeof window === 'undefined') return;

    const inviteUrl = buildMarketplaceInviteUrl(window.location.origin, marketplace);
    if (!inviteUrl) {
      notifyError('Unable to generate invite link right now.');
      return;
    }

    try {
      if (navigator.share) {
        await navigator.share({
          title: `${marketplace?.name || 'Predict Cornell'} invite`,
          text: 'Join this marketplace on Predict Cornell. Share the password separately.',
          url: inviteUrl
        });
        notifySuccess('Invite shared. Members still need the marketplace password.');
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
        notifySuccess('Invite link copied. Share the marketplace password separately.');
        return;
      }

      notifyError('Share is unavailable on this browser.');
    } catch (error) {
      if (error?.name !== 'AbortError') {
        notifyError('Unable to share invite link right now.');
      }
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <p className="font-mono text-[var(--text-muted)]">Loading marketplace...</p>
      </div>
    );
  }

  if (!user || error) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6">
        <p className="font-mono text-[var(--text-muted)]">{error || 'Unable to load marketplace.'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-8 md:px-8 md:py-10">
      <div className="mx-auto max-w-[1150px]">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] pb-6">
          <div>
            <p className="mb-2 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-[var(--red)]">
              <span className="inline-block h-px w-5 bg-[var(--red)]" />
              Marketplace
            </p>
            <h1 className="font-display text-[2.2rem] leading-[1.05] text-[var(--text)]">{marketplace.name}</h1>
            <p className="mt-2 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
              {membership.role === MARKETPLACE_ROLE.CREATOR ? 'Creator' : 'Member'} · Balance ${Number(membership.balance || 0).toFixed(2)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/marketplace/${marketplaceId}/markets`} className="rounded border border-[var(--border2)] bg-[var(--surface)] px-3 py-2 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[var(--text-dim)] hover:text-[var(--text)]">
              Markets
            </Link>
            <Link href={`/marketplace/${marketplaceId}/leaderboard`} className="rounded border border-[var(--border2)] bg-[var(--surface)] px-3 py-2 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[var(--text-dim)] hover:text-[var(--text)]">
              Leaderboard
            </Link>
            {isCreator && (
              <>
                <button
                  type="button"
                  onClick={handleShareMarketplace}
                  className="rounded border border-[var(--border2)] bg-[var(--surface)] px-3 py-2 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[var(--text-dim)] hover:text-[var(--text)]"
                >
                  Share
                </button>
                <Link href={`/marketplace/${marketplaceId}/admin`} className="rounded border border-[var(--red-dim)] bg-[var(--red)] px-3 py-2 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-white hover:bg-[var(--red-dim)]">
                  Creator Admin
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="mb-8 grid gap-[1px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--border)] md:grid-cols-4">
          <StatCell label="Active Markets" value={stats.activeCount} tone="red" />
          <StatCell label="Avg YES" value={`${Math.round(stats.averageProbability * 100)}%`} tone="amber" />
          <StatCell
            label="Highest Conviction"
            value={stats.highestConviction ? `${Math.round(stats.highestConviction.market.probability * 100)}%` : '—'}
            tone="green"
          />
          <StatCell
            label="Top Volume"
            value={stats.topVolume ? `$${Math.round(stats.topVolume.volume).toLocaleString()}` : '$0'}
            tone="dim"
          />
        </div>

        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
              Sentiment Tracker
            </span>
            <Link href={`/marketplace/${marketplaceId}/markets`} className="font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:text-[var(--text)]">
              Open full market list →
            </Link>
          </div>

          <div className="space-y-2">
            {markets.length === 0 ? (
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-5 text-sm text-[var(--text-dim)]">
                No markets yet in this marketplace.
              </div>
            ) : (
              markets.slice(0, 12).map((market) => (
                <Link
                  key={market.id}
                  href={`/market/${market.id}`}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 hover:bg-[var(--surface2)]"
                >
                  <span className="text-sm text-[var(--text)]">{market.question}</span>
                  <span className={`font-mono text-[1rem] font-bold ${probabilityClass(Number(market.probability || 0))}`}>
                    {Math.round(Number(market.probability || 0) * 100)}%
                  </span>
                  <span className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    ${Math.round(Number(volumeByMarket[market.id] || 0)).toLocaleString()}
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
      <ToastStack toasts={toasts} onDismiss={removeToast} onConfirm={resolveConfirm} />
    </div>
  );
}

function StatCell({ label, value, tone }) {
  const toneClass = tone === 'red'
    ? 'text-[var(--red)]'
    : tone === 'green'
      ? 'text-[var(--green-bright)]'
      : tone === 'amber'
        ? 'text-[var(--amber-bright)]'
        : 'text-[var(--text-dim)]';
  return (
    <div className="bg-[var(--surface)] px-5 py-4">
      <p className="mb-1 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}</p>
      <p className={`font-mono text-[1.3rem] font-bold tracking-[-0.03em] ${toneClass}`}>{value}</p>
    </div>
  );
}
