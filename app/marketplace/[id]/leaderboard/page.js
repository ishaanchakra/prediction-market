'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getPublicDisplayName } from '@/utils/displayName';
import { MARKET_STATUS } from '@/utils/marketStatus';
import { toMarketplaceMemberId } from '@/utils/marketplace';
import { calculateMarketplacePortfolioRows } from '@/utils/marketplacePortfolio';
import { fetchMarketplaceContext, fetchMarketplaceMarkets } from '@/utils/marketplaceClient';
import { round2 } from '@/utils/round';

const ADMIN_EMAILS = ['ichakravorty14@gmail.com', 'ic367@cornell.edu'];

function fmtMoney(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toDate(value) {
  if (value?.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function isPermissionDenied(error) {
  return error?.code === 'permission-denied'
    || String(error?.message || '').toLowerCase().includes('missing or insufficient permissions');
}

export default function MarketplaceLeaderboardPage() {
  const params = useParams();
  const router = useRouter();
  const marketplaceId = params?.id;

  const [loading, setLoading] = useState(true);
  const [marketplace, setMarketplace] = useState(null);
  const [membership, setMembership] = useState(null);
  const [memberRows, setMemberRows] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [weeklyRows, setWeeklyRows] = useState([]);
  const [weeklySnapshots, setWeeklySnapshots] = useState([]);
  const [expandedSnapshot, setExpandedSnapshot] = useState(null);
  const [limitedLeaderboard, setLimitedLeaderboard] = useState(false);
  const [error, setError] = useState('');

  const weeklySorted = useMemo(
    () => [...weeklyRows].sort((a, b) => Number(b.portfolioValue || 0) - Number(a.portfolioValue || 0)),
    [weeklyRows]
  );
  const lifetimeSorted = useMemo(
    () => [...memberRows].sort((a, b) => Number(b.lifetimeRep || 0) - Number(a.lifetimeRep || 0)),
    [memberRows]
  );
  const dueForWeeklyReset = useMemo(() => {
    if (marketplace?.resetMode !== 'WEEKLY') return false;
    if (!marketplace?.nextResetAt) return false;
    return toDate(marketplace.nextResetAt).getTime() <= Date.now();
  }, [marketplace]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }
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
        setLimitedLeaderboard(false);

        const canViewFullLeaderboard = context.membership.role === 'CREATOR'
          || ADMIN_EMAILS.includes(currentUser.email || '');
        let members = [];
        if (canViewFullLeaderboard) {
          const membersSnap = await getDocs(
            query(collection(db, 'marketplaceMembers'), where('marketplaceId', '==', marketplaceId), orderBy('balance', 'desc'), limit(500))
          );
          members = membersSnap.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
        } else {
          members = [{ id: toMarketplaceMemberId(marketplaceId, currentUser.uid), ...context.membership }];
          setLimitedLeaderboard(true);
        }
        setMemberRows(members);

        const openMarkets = (await fetchMarketplaceMarkets(marketplaceId)).filter((market) => {
          const status = market.status;
          return (status === MARKET_STATUS.OPEN || status === MARKET_STATUS.LOCKED || !status) && market.resolution == null;
        });

        const betsSnap = await getDocs(query(collection(db, 'bets'), where('marketplaceId', '==', marketplaceId)));
        const bets = betsSnap.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));

        const rows = calculateMarketplacePortfolioRows({
          members,
          bets,
          openMarkets,
          startingBalance: Number(context.marketplace.startingBalance || 500)
        }).map((entry) => ({
          ...entry,
          weeklyNet: round2(entry.weeklyNet),
          portfolioValue: round2(entry.portfolioValue)
        }));
        setWeeklyRows(rows);

        const snapshotsSnap = await getDocs(
          query(
            collection(db, 'marketplaceWeeklySnapshots'),
            where('marketplaceId', '==', marketplaceId),
            orderBy('snapshotDate', 'desc'),
            limit(20)
          )
        );
        setWeeklySnapshots(snapshotsSnap.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));

        const userIds = [...new Set(members.map((member) => member.userId).filter(Boolean))];
        const users = await Promise.all(
          userIds.map(async (userId) => {
            const userSnap = await getDoc(doc(db, 'users', userId));
            return [userId, userSnap.exists() ? userSnap.data() : {}];
          })
        );
        setUserMap(Object.fromEntries(users));
      } catch (err) {
        if (isPermissionDenied(err)) {
          setError('Leaderboard visibility is limited for this account.');
          setLoading(false);
          return;
        }
        console.error('Error loading marketplace leaderboard:', err);
        setError('Unable to load leaderboard right now.');
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [marketplaceId, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <p className="font-mono text-[var(--text-muted)]">Loading leaderboard...</p>
      </div>
    );
  }

  if (!marketplace || error) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6">
        <p className="font-mono text-[var(--text-muted)]">{error || 'Leaderboard unavailable.'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-8 md:px-8 md:py-10">
      <div className="mx-auto max-w-[1050px]">
        <div className="mb-8 border-b border-[var(--border)] pb-6">
          <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
            <Link href={`/marketplace/${marketplaceId}`} className="text-[var(--text-dim)] hover:text-[var(--text)]">
              {marketplace.name}
            </Link>{' '}
            / Leaderboard
          </p>
          <h1 className="font-display text-[2rem] text-[var(--text)]">Marketplace Leaderboard</h1>
          <p className="mt-2 font-mono text-[0.64rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Reset mode: {marketplace.resetMode || 'WEEKLY'} {dueForWeeklyReset ? '· reset due now' : ''}
          </p>
          {membership?.userId && (
            <p className="mt-1 font-mono text-[0.62rem] text-[var(--text-dim)]">
              Your wallet: ${Number(membership.balance || 0).toFixed(2)}
            </p>
          )}
          {limitedLeaderboard && (
            <p className="mt-1 font-mono text-[0.62rem] text-[var(--text-muted)]">
              Limited view: only your live wallet is shown. Full rankings appear in weekly snapshots.
            </p>
          )}
        </div>

        <TableBlock
          title="Weekly (Portfolio Net)"
          rows={weeklySorted}
          userMap={userMap}
          metricFn={(entry) => Number(entry.weeklyNet || 0)}
          detailsFn={(entry) => `Portfolio $${fmtMoney(entry.portfolioValue)} · Cash $${fmtMoney(entry.cashBalance)} · Positions $${fmtMoney(entry.positionsValue)}`}
          currentUserId={membership?.userId}
        />

        <TableBlock
          title="Lifetime (Marketplace)"
          rows={lifetimeSorted}
          userMap={userMap}
          metricFn={(entry) => Number(entry.lifetimeRep || 0)}
          detailsFn={() => ''}
          currentUserId={membership?.userId}
        />

        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
              Past Weeks
            </span>
          </div>

          <div className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
            {weeklySnapshots.length === 0 ? (
              <p className="px-5 py-4 font-mono text-[0.68rem] text-[var(--text-muted)]">No snapshots yet.</p>
            ) : (
              weeklySnapshots.map((snapshot) => {
                const top = Array.isArray(snapshot.rankings) ? snapshot.rankings[0] : null;
                const expanded = expandedSnapshot === snapshot.id;
                return (
                  <div key={snapshot.id} className="border-b border-[var(--border)] last:border-b-0">
                    <button
                      onClick={() => setExpandedSnapshot(expanded ? null : snapshot.id)}
                      className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-[var(--surface2)]"
                    >
                      <span className="font-mono text-[0.65rem] text-[var(--text-dim)]">
                        {snapshot.weekOf || toDate(snapshot.snapshotDate).toISOString().slice(0, 10)}
                      </span>
                      <span className="text-sm text-[var(--text)]">{top?.displayName || 'No champion'}</span>
                      <span className="font-mono text-[0.72rem] text-[var(--green-bright)]">
                        {top ? `+$${fmtMoney(top.netProfit)}` : '—'}
                      </span>
                    </button>
                    {expanded && (
                      <div className="border-t border-[var(--border)] bg-[var(--surface2)] px-5 py-3">
                        {(snapshot.rankings || []).slice(0, 10).map((row) => (
                          <div key={row.userId} className="grid grid-cols-[32px_1fr_auto] items-center py-1.5">
                            <span className="font-mono text-[0.62rem] text-[var(--text-muted)]">#{row.rank}</span>
                            <span className="text-sm text-[var(--text)]">{row.displayName}</span>
                            <span className={`font-mono text-[0.72rem] ${Number(row.netProfit || 0) >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
                              {Number(row.netProfit || 0) >= 0 ? '+' : '-'}${fmtMoney(Math.abs(Number(row.netProfit || 0)))}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function TableBlock({ title, rows, userMap, metricFn, detailsFn, currentUserId }) {
  const maxAbs = Math.max(...rows.map((row) => Math.abs(metricFn(row))), 1);
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
          {title}
        </span>
      </div>
      <table className="w-full overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="px-4 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Rank</th>
            <th className="px-4 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Trader</th>
            <th className="px-4 py-3 text-right font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Net Profit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const metric = Number(metricFn(row) || 0);
            const positive = metric >= 0;
            const barWidth = Math.max(2, Math.round((Math.abs(metric) / maxAbs) * 90));
            const displayName = getPublicDisplayName({ id: row.userId, ...(userMap[row.userId] || {}) });
            return (
              <tr key={row.id || row.userId} className={`border-b border-[var(--border)] last:border-b-0 ${currentUserId === row.userId ? 'bg-[rgba(220,38,38,.05)]' : ''}`}>
                <td className="px-4 py-3 font-mono text-[0.78rem] text-[var(--text)]">#{index + 1}</td>
                <td className="px-4 py-3">
                  <p className="text-sm font-semibold text-[var(--text)]">{displayName}</p>
                  {!!detailsFn(row) && <p className="font-mono text-[0.58rem] text-[var(--text-muted)]">{detailsFn(row)}</p>}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-mono text-[0.82rem] font-bold ${positive ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
                    {positive ? '+' : '-'}${fmtMoney(Math.abs(metric))}
                  </span>
                  <span className="ml-auto mt-1 block h-[2px] w-24 rounded bg-[var(--surface3)]">
                    <span className={`block h-[2px] rounded ${positive ? 'bg-[var(--green-bright)]' : 'bg-[var(--red)]'}`} style={{ width: `${barWidth}px` }} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
