'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import MutedTrendBackground from '@/app/components/MutedTrendBackground';
import { CATEGORIES } from '@/utils/categorize';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';

const STATUS_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'cancelled', label: 'Cancelled' }
];

const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest' },
  { id: 'active', label: 'Most Active' },
  { id: 'prob-high', label: 'Prob: High → Low' },
  { id: 'prob-low', label: 'Prob: Low → High' },
  { id: 'toss-up', label: 'Toss-Up' }
];

function toMillis(value) {
  if (value?.toDate) return value.toDate().getTime();
  const parsed = new Date(value);
  const ts = parsed.getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

function toStatusBucket(market) {
  const status = getMarketStatus(market);
  if (status === MARKET_STATUS.CANCELLED) return 'cancelled';
  if (status === MARKET_STATUS.RESOLVED) return 'resolved';
  if (status === MARKET_STATUS.OPEN || status === MARKET_STATUS.LOCKED) return 'active';
  return market?.resolution != null ? 'resolved' : 'active';
}

function probabilityStyle(probability) {
  if (probability > 0.65) return 'text-[var(--green-bright)]';
  if (probability < 0.35) return 'text-[var(--red)]';
  return 'text-[var(--amber-bright)]';
}

function AllMarketsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [markets, setMarkets] = useState([]);
  const [trendSeriesByMarket, setTrendSeriesByMarket] = useState({});
  const [betCountByMarket, setBetCountByMarket] = useState({});
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const validStatusIds = useMemo(() => new Set(STATUS_OPTIONS.map((entry) => entry.id)), []);
  const validSortIds = useMemo(() => new Set(SORT_OPTIONS.map((entry) => entry.id)), []);
  const validCategoryIds = useMemo(() => new Set(CATEGORIES.map((entry) => entry.id)), []);

  const rawStatus = searchParams.get('status');
  const rawCategory = searchParams.get('category');
  const rawSort = searchParams.get('sort');
  const rawQuery = searchParams.get('q') || '';

  const statusFilter = validStatusIds.has(rawStatus) ? rawStatus : 'all';
  const categoryFilter = validCategoryIds.has(rawCategory) ? rawCategory : 'all';
  const sortBy = validSortIds.has(rawSort) ? rawSort : 'newest';
  const searchQuery = rawQuery.trim();

  function buildQueryString({ status, category, sort, q }) {
    const params = new URLSearchParams();
    if (status && status !== 'all') params.set('status', status);
    if (category && category !== 'all') params.set('category', category);
    if (sort && sort !== 'newest') params.set('sort', sort);
    if (q) params.set('q', q);
    return params.toString();
  }

  function replaceFilters(patch) {
    const next = {
      status: statusFilter,
      category: categoryFilter,
      sort: sortBy,
      q: searchQuery,
      ...patch
    };
    const queryString = buildQueryString({
      status: next.status,
      category: next.category,
      sort: next.sort,
      q: String(next.q || '').trim()
    });
    router.replace(queryString ? `/markets?${queryString}` : '/markets', { scroll: false });
  }

  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  const currentQueryString = searchParams.toString();
  useEffect(() => {
    const canonicalQueryString = buildQueryString({
      status: statusFilter,
      category: categoryFilter,
      sort: sortBy,
      q: searchQuery
    });
    if (currentQueryString !== canonicalQueryString) {
      router.replace(canonicalQueryString ? `/markets?${canonicalQueryString}` : '/markets', { scroll: false });
    }
  }, [categoryFilter, currentQueryString, router, searchQuery, sortBy, statusFilter]);

  useEffect(() => {
    async function fetchAllMarketsData() {
      try {
        setLoadError('');

        const marketSnapshot = await getDocs(
          query(collection(db, 'markets'), where('marketplaceId', '==', null))
        );
        const marketRows = marketSnapshot.docs
          .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
          .filter((market) => !market.marketplaceId);
        setMarkets(marketRows);

        const betsSnapshot = await getDocs(
          query(collection(db, 'bets'), where('marketplaceId', '==', null))
        );
        const groupedByMarket = new Map();
        betsSnapshot.docs.forEach((snapshotDoc) => {
          const bet = snapshotDoc.data();
          const marketId = bet.marketId;
          if (!marketId) return;
          if (!groupedByMarket.has(marketId)) groupedByMarket.set(marketId, []);
          groupedByMarket.get(marketId).push({
            probability: Number(bet.probability),
            timestamp: toMillis(bet.timestamp)
          });
        });

        const nextSeriesByMarket = {};
        const nextCountByMarket = {};
        marketRows.forEach((market) => {
          const rows = groupedByMarket.get(market.id) || [];
          nextCountByMarket[market.id] = rows.length;

          const sorted = [...rows]
            .filter((entry) => Number.isFinite(entry.probability))
            .sort((a, b) => a.timestamp - b.timestamp);
          const probabilities = sorted.map((entry) => entry.probability);

          const initial = typeof market.initialProbability === 'number'
            ? market.initialProbability
            : (probabilities[0] ?? Number(market.probability || 0.5));
          nextSeriesByMarket[market.id] = probabilities.length ? [initial, ...probabilities] : [initial, initial];
        });

        setTrendSeriesByMarket(nextSeriesByMarket);
        setBetCountByMarket(nextCountByMarket);
      } catch (error) {
        console.error('Error fetching all markets:', error);
        setLoadError('Unable to load markets right now.');
      } finally {
        setLoading(false);
      }
    }

    fetchAllMarketsData();
  }, []);

  const filteredMarkets = useMemo(() => {
    let result = [...markets];

    if (statusFilter !== 'all') {
      result = result.filter((market) => toStatusBucket(market) === statusFilter);
    }

    if (categoryFilter !== 'all') {
      result = result.filter((market) => (market.category || 'wildcard') === categoryFilter);
    }

    if (searchQuery) {
      const needle = searchQuery.toLowerCase();
      result = result.filter((market) => String(market.question || '').toLowerCase().includes(needle));
    }

    return result.sort((a, b) => {
      switch (sortBy) {
        case 'active':
          return (betCountByMarket[b.id] || 0) - (betCountByMarket[a.id] || 0);
        case 'prob-high':
          return Number(b.probability || 0) - Number(a.probability || 0);
        case 'prob-low':
          return Number(a.probability || 0) - Number(b.probability || 0);
        case 'toss-up':
          return Math.abs(Number(a.probability || 0.5) - 0.5) - Math.abs(Number(b.probability || 0.5) - 0.5);
        default:
          return toMillis(b.createdAt) - toMillis(a.createdAt);
      }
    });
  }, [betCountByMarket, categoryFilter, markets, searchQuery, sortBy, statusFilter]);

  const selectedCategoryLabel = CATEGORIES.find((entry) => entry.id === categoryFilter)?.label || 'All Markets';
  const selectedStatusLabel = STATUS_OPTIONS.find((entry) => entry.id === statusFilter)?.label || 'All';
  const emptyStateMessage = useMemo(() => {
    if (searchQuery) {
      if (categoryFilter === 'all' && statusFilter === 'all') {
        return `No global markets match "${searchQuery}".`;
      }
      if (categoryFilter === 'all') {
        return `No ${selectedStatusLabel.toLowerCase()} markets match "${searchQuery}".`;
      }
      return `No ${selectedStatusLabel.toLowerCase()} ${selectedCategoryLabel.toLowerCase()} markets match "${searchQuery}".`;
    }
    if (categoryFilter !== 'all' && statusFilter !== 'all') {
      return `No ${selectedStatusLabel.toLowerCase()} ${selectedCategoryLabel.toLowerCase()} markets right now.`;
    }
    if (categoryFilter !== 'all') {
      return `No ${selectedCategoryLabel.toLowerCase()} markets right now.`;
    }
    if (statusFilter !== 'all') {
      return `No ${selectedStatusLabel.toLowerCase()} markets right now.`;
    }
    return 'No global markets yet.';
  }, [categoryFilter, searchQuery, selectedCategoryLabel, selectedStatusLabel, statusFilter]);

  function handleSearchSubmit(e) {
    e.preventDefault();
    replaceFilters({ q: searchInput.trim() });
  }

  if (loading) {
    return (
      <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">
        Loading...
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-[var(--bg)] min-h-screen">
      {loadError && (
        <div className="mb-4 rounded border border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.08)] px-4 py-2 font-mono text-[0.65rem] text-[#f59e0b]">
          {loadError}
        </div>
      )}

      <h1 className="mb-2 font-sans text-3xl font-extrabold text-[var(--text)]">All Markets</h1>
      <p className="mb-6 text-[var(--text-dim)]">
        {filteredMarkets.length} markets shown
        {statusFilter !== 'all' ? ` · ${statusFilter}` : ''}
        {categoryFilter !== 'all' ? ` · ${selectedCategoryLabel}` : ''}
        {searchQuery ? ` · search: "${searchQuery}"` : ''}
      </p>

      <div className="hidden md:flex items-center gap-2 mb-4 flex-wrap">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">Status:</span>
        {STATUS_OPTIONS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => replaceFilters({ status: entry.id })}
            className={`
              px-4 py-1.5 rounded-full font-mono text-[0.65rem] uppercase tracking-[0.08em]
              border transition-colors
              ${statusFilter === entry.id
                ? 'bg-[var(--red)] border-[var(--red)] text-white'
                : 'bg-transparent border-[var(--border2)] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]'}
            `}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="hidden md:flex items-center gap-2 mb-4 flex-wrap">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">Category:</span>
        {CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            onClick={() => replaceFilters({ category: entry.id })}
            className={`
              px-4 py-1.5 rounded-full font-mono text-[0.65rem] uppercase tracking-[0.08em]
              border transition-colors
              ${categoryFilter === entry.id
                ? 'bg-[var(--red)] border-[var(--red)] text-white'
                : 'bg-transparent border-[var(--border2)] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]'}
            `}
          >
            {entry.emoji} {entry.label}
          </button>
        ))}
      </div>

      <div className="hidden md:flex items-center gap-2 mb-6 flex-wrap">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">Sort:</span>
        {SORT_OPTIONS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => replaceFilters({ sort: entry.id })}
            className={`
              px-4 py-1.5 rounded-full font-mono text-[0.65rem] uppercase tracking-[0.08em]
              border transition-colors
              ${sortBy === entry.id
                ? 'bg-[var(--red)] border-[var(--red)] text-white'
                : 'bg-transparent border-[var(--border2)] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]'}
            `}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSearchSubmit} className="mb-6 flex items-center gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search global market questions..."
          className="w-full rounded border border-[var(--border2)] bg-[var(--surface)] px-3 py-2 font-mono text-[0.75rem] text-[var(--text)]"
        />
        <button
          type="submit"
          className="rounded border border-[var(--red)] bg-[var(--red)] px-3 py-2 font-mono text-[0.66rem] uppercase tracking-[0.08em] text-white"
        >
          Search
        </button>
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              replaceFilters({ q: '' });
            }}
            className="rounded border border-[var(--border2)] bg-[var(--surface)] px-3 py-2 font-mono text-[0.66rem] uppercase tracking-[0.08em] text-[var(--text-dim)]"
          >
            Clear
          </button>
        )}
      </form>

      <div className="md:hidden mb-3">
        <select
          value={statusFilter}
          onChange={(e) => replaceFilters({ status: e.target.value })}
          className="w-full bg-[var(--surface)] border border-[var(--border2)] text-[var(--text)] font-mono text-[0.75rem] px-4 py-3 rounded-[4px] appearance-none"
          style={{ fontSize: '16px' }}
        >
          {STATUS_OPTIONS.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.label}</option>
          ))}
        </select>
      </div>

      <div className="md:hidden mb-3">
        <select
          value={categoryFilter}
          onChange={(e) => replaceFilters({ category: e.target.value })}
          className="w-full bg-[var(--surface)] border border-[var(--border2)] text-[var(--text)] font-mono text-[0.75rem] px-4 py-3 rounded-[4px] appearance-none"
          style={{ fontSize: '16px' }}
        >
          {CATEGORIES.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.emoji} {entry.label}</option>
          ))}
        </select>
      </div>

      <div className="md:hidden mb-6">
        <select
          value={sortBy}
          onChange={(e) => replaceFilters({ sort: e.target.value })}
          className="w-full bg-[var(--surface)] border border-[var(--border2)] text-[var(--text)] font-mono text-[0.75rem] px-4 py-3 rounded-[4px] appearance-none"
          style={{ fontSize: '16px' }}
        >
          {SORT_OPTIONS.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.label}</option>
          ))}
        </select>
      </div>

      {filteredMarkets.length === 0 ? (
        <div className="text-center py-12 bg-[var(--surface)] border border-[var(--border)] rounded-lg">
          <p className="text-[var(--text-muted)]">{emptyStateMessage}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredMarkets.map((market) => {
            const status = getMarketStatus(market);
            const statusBucket = toStatusBucket(market);
            const probability = Number(market.probability || 0);
            const probabilityPercent = Math.round(probability * 100);
            const isCancelled = statusBucket === 'cancelled';
            const isResolved = statusBucket === 'resolved';

            return (
              <Link key={market.id} href={`/market/${market.id}`} className="block group">
                <div className="relative bg-[var(--surface)] rounded-lg border border-[var(--border)] hover:border-[var(--border2)] hover:shadow-lg transition-all duration-200 p-6 h-full overflow-hidden">
                  <MutedTrendBackground series={trendSeriesByMarket[market.id]} probability={market.probability} />
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h2 className="text-lg font-semibold text-[var(--text)] group-hover:text-brand-red transition-colors min-h-[60px] relative z-10">
                      {market.question}
                    </h2>
                    <span className={`relative z-10 px-2 py-1 rounded-full text-xs font-bold ${
                      statusBucket === 'active'
                        ? status === MARKET_STATUS.LOCKED
                          ? 'bg-[rgba(217,119,6,0.12)] text-[#f59e0b]'
                          : 'bg-[rgba(34,197,94,0.12)] text-[#22c55e]'
                        : statusBucket === 'resolved'
                          ? 'bg-[rgba(22,163,74,0.12)] text-[var(--green-bright)]'
                          : 'bg-[var(--red-glow)] text-[var(--red)]'
                    }`}>
                      {statusBucket}
                    </span>
                  </div>

                  <div className="mb-3 flex items-center justify-between relative z-10">
                    <span className="rounded-[3px] border border-[var(--border2)] bg-[var(--surface3)] px-2 py-[0.15rem] font-mono text-[0.5rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      {(market.category || 'wildcard')}
                    </span>
                    <span className="font-mono text-[0.55rem] text-[var(--text-muted)]">
                      {(betCountByMarket[market.id] || 0).toLocaleString()} trades
                    </span>
                  </div>

                  {isCancelled ? (
                    <div className="relative z-10 inline-block rounded-[3px] bg-[var(--surface2)] px-3 py-1 text-sm font-semibold text-[var(--text-dim)]">
                      Cancelled + Refunded
                    </div>
                  ) : isResolved ? (
                    <div className={`relative z-10 inline-block rounded-[3px] px-3 py-1 text-sm font-semibold ${market.resolution === 'YES' ? 'border border-[rgba(22,163,74,0.2)] bg-[rgba(22,163,74,0.1)] text-[var(--green-bright)]' : 'border border-[rgba(220,38,38,0.2)] bg-[var(--red-glow)] text-[var(--red)]'}`}>
                      Resolved: {market.resolution}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-2 relative z-10">
                        <span className="text-sm font-medium text-[var(--text-muted)]">Probability</span>
                        <span className={`text-3xl font-bold ${probabilityStyle(probability)}`}>
                          {Number.isFinite(probability) ? `${probabilityPercent}%` : 'N/A'}
                        </span>
                      </div>
                      {Number.isFinite(probability) && (
                        <div className="w-full bg-[var(--surface3)] rounded-full h-2 relative z-10">
                          <div
                            className="h-2 rounded-full transition-all duration-300"
                            style={{ width: `${Math.max(0, Math.min(100, probability * 100))}%` }}
                          />
                        </div>
                      )}
                    </>
                  )}

                  <p className="text-xs text-[var(--text-muted)] mt-3 relative z-10">
                    {toMillis(market.resolvedAt) > 0
                      ? new Date(toMillis(market.resolvedAt)).toLocaleDateString()
                      : toMillis(market.cancelledAt) > 0
                        ? new Date(toMillis(market.cancelledAt)).toLocaleDateString()
                        : toMillis(market.createdAt) > 0
                          ? new Date(toMillis(market.createdAt)).toLocaleDateString()
                          : 'Recently'}
                  </p>

                  <div className="mt-4 text-sm text-[var(--red)] font-medium group-hover:underline relative z-10">
                    View market →
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

export default function AllMarketsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">
          Loading...
        </div>
      }
    >
      <AllMarketsContent />
    </Suspense>
  );
}
