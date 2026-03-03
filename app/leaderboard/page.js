'use client';
import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { getPublicDisplayName } from '@/utils/displayName';
import { round2 } from '@/utils/round';
import { calculateAllPortfolioValues } from '@/utils/portfolio';
import ToastStack from '@/app/components/ToastStack';
import useToastQueue from '@/app/hooks/useToastQueue';

function fmtMoney(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getWeekNumber() {
  const semesterStart = new Date('2026-01-19');
  const now = new Date();
  const diff = Math.floor((now - semesterStart) / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, diff + 1);
}

function getCurrentWeekWindow(nowValue = new Date()) {
  const now = new Date(nowValue);
  const day = now.getDay();
  const daysSinceMonday = (day + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - daysSinceMonday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

function formatWeekWindow(startValue, endValue) {
  const start = toDate(startValue);
  const end = toDate(endValue);
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
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

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchBetsByMarketIds(marketIds) {
  if (marketIds.length === 0) return [];
  const chunks = chunkArray(marketIds, 30);
  const snapshots = await Promise.all(
    chunks.map((chunk) =>
      getDocs(
        query(
          collection(db, 'bets'),
          where('marketplaceId', '==', null),
          where('marketId', 'in', chunk)
        )
      )
    )
  );
  return snapshots.flatMap((snapshot) => snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
}

function rankDisplay(index) {
  if (index === 0) return '🥇';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  return String(index + 1).padStart(2, '0');
}

function rankColorClass(index) {
  if (index === 0) return 'text-[var(--amber-bright)]';
  if (index === 1) return 'text-[#9ca3af]';
  if (index === 2) return 'text-[#b45309]';
  return 'text-[var(--text-muted)]';
}

function initialsForName(name) {
  const safe = String(name || '').trim();
  if (!safe) return 'PC';
  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function pctReturn(user) {
  const baseline = Number(user.totalDeposits || 1000);
  if (baseline === 0) return '0.0';
  const pct = ((Number(user.netPnl || 0) / baseline) * 100);
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}`;
}

function positionLabel(user) {
  return Number(user.positionsValue || 0) > 0 ? 'has open positions' : 'no open positions';
}

function YouBadge() {
  return (
    <span className="rounded border border-[rgba(220,38,38,.2)] bg-[var(--red-glow)] px-1.5 py-[0.1rem] font-mono text-[0.44rem] uppercase tracking-[0.08em] text-[var(--red)]">
      you
    </span>
  );
}

function BarMini({ value, max, colorClass }) {
  const width = Math.max(2, Math.round((value / Math.max(max, 1)) * 80));
  return (
    <span className="ml-auto mt-[4px] block h-[2px] w-20 rounded bg-[var(--surface3)]">
      <span
        className={`block h-[2px] rounded ${colorClass}`}
        style={{ width: `${width}px` }}
      />
    </span>
  );
}

function FormulaTooltip({ formula }) {
  return (
    <span className="group relative ml-2 inline-flex cursor-help items-center" title={formula}>
      <span className="rounded border border-[var(--border2)] bg-[var(--surface3)] px-[5px] py-[1px] font-mono text-[0.44rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
        formula
      </span>
      <div className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 w-max max-w-[260px] rounded-[6px] border border-[var(--border2)] bg-[var(--surface2)] px-3 py-2 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        <p className="font-mono text-[0.58rem] leading-[1.6] text-[var(--text-dim)]">{formula}</p>
      </div>
    </span>
  );
}

export default function LeaderboardPage() {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [weeklyRows, setWeeklyRows] = useState([]);
  const [weeklySnapshots, setWeeklySnapshots] = useState([]);
  const [expandedWeeks, setExpandedWeeks] = useState({});
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState(null);
  const [activeTab, setActiveTab] = useState('oracle');
  const { toasts, removeToast, resolveConfirm } = useToastQueue();

  const oracleUsers = useMemo(
    () =>
      [...users]
        .filter((u) => Number(u.oracleMarketsScored || 0) >= 1)
        .sort((a, b) => Number(b.oracleScore || 0) - Number(a.oracleScore || 0))
        .slice(0, 50),
    [users]
  );
  const netPnlUsers = useMemo(
    () =>
      [...weeklyRows]
        .sort((a, b) => Number(b.netPnl || 0) - Number(a.netPnl || 0))
        .slice(0, 50),
    [weeklyRows]
  );

  const meNetPnl = useMemo(() => netPnlUsers.find((entry) => entry.id === viewer?.uid), [netPnlUsers, viewer]);
  const meNetPnlRank = useMemo(() => netPnlUsers.findIndex((entry) => entry.id === viewer?.uid), [netPnlUsers, viewer]);
  const activeTradersCount = useMemo(
    () => weeklyRows.filter((row) => Math.abs(Number(row.netPnl || 0)) > 0.001).length,
    [weeklyRows]
  );

  const maxNetPnl = useMemo(
    () => Math.max(...netPnlUsers.map((u) => Math.abs(Number(u.netPnl || 0))), 1),
    [netPnlUsers]
  );
  const myRankData = useMemo(() => {
    if (!viewer?.uid) return null;

    if (activeTab === 'netpnl') {
      if (!meNetPnl) return null;
      return {
        rank: meNetPnlRank + 1,
        displayName: getPublicDisplayName(meNetPnl),
        metric: meNetPnl.netPnl,
        metricLabel: `${meNetPnl.netPnl >= 0 ? '+' : ''}$${fmtMoney(Math.abs(meNetPnl.netPnl))}`,
        sub: `${pctReturn(meNetPnl)}% return`
      };
    }

    if (activeTab === 'oracle') {
      const idx = oracleUsers.findIndex((u) => u.id === viewer.uid);
      if (idx < 0) return null;
      const row = oracleUsers[idx];
      return {
        rank: idx + 1,
        displayName: getPublicDisplayName(row),
        metric: row.oracleScore,
        metricLabel: `${Number(row.oracleScore || 0).toFixed(1)} pts`,
        sub: `${Number(row.oracleMarketsScored || 0)} markets scored`
      };
    }

    return null;
  }, [activeTab, oracleUsers, viewer, meNetPnl, meNetPnlRank]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => setViewer(currentUser));
    return () => unsubscribe();
  }, []);

  const rankMetricColorClass = activeTab === 'oracle'
    ? 'text-[var(--amber-bright)]'
    : (Number(myRankData?.metric || 0) >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]');

  useEffect(() => {
    async function fetchAll() {
      try {
        const usersQ = query(collection(db, 'users'), orderBy('lifetimeRep', 'desc'), limit(300));
        const openQ = query(
          collection(db, 'markets'),
          where('resolution', '==', null),
          where('marketplaceId', '==', null)
        );
        const snapshotsQ = query(collection(db, 'weeklySnapshots'), orderBy('snapshotDate', 'desc'), limit(12));

        const [usersSnap, openSnap, snapshotsSnap] = await Promise.all([
          getDocs(usersQ),
          getDocs(openQ),
          getDocs(snapshotsQ),
        ]);

        const usersData = usersSnap.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
        setUsers(usersData);
        setWeeklySnapshots(snapshotsSnap.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));

        const openMarkets = openSnap.docs
          .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
          .filter((market) => !market.marketplaceId)
          .filter((market) => market.status !== 'CANCELLED');

        const openMarketIds = openMarkets.map((market) => market.id);
        const openBets = await fetchBetsByMarketIds(openMarketIds);

        const weeklyRowsData = calculateAllPortfolioValues({
          users: usersData,
          bets: openBets,
          openMarkets
        }).map((row) => ({
          ...row,
          portfolioValue: round2(row.portfolioValue),
          cashBalance: round2(row.cashBalance),
          positionsValue: round2(row.positionsValue),
          netPnl: round2(row.netPnl)
        }));
        setWeeklyRows(weeklyRowsData);
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.error('Error fetching leaderboard:', error);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <p className="font-mono text-[var(--text-muted)]">Loading leaderboard...</p>
      </div>
    );
  }

  const currentWeekNumber = getWeekNumber();

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-10 sm:px-5">
      <div className="mx-auto max-w-[760px]">
        <div className="mb-7">
          <p className="mb-3 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[var(--red)]">
            <span className="inline-block h-px w-5 bg-[var(--red)]" />
            Spring 2026 · Week {currentWeekNumber}
          </p>
          <h1 className="mb-2 font-display text-[2.4rem] italic leading-[1] tracking-[-0.02em] text-[var(--text)]">
            Leaderboard
          </h1>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
            {activeTradersCount} active traders · updates continuously
          </p>
        </div>

        {myRankData && (
          <div className="mb-6 flex items-center gap-4 rounded-[8px] border border-[var(--border2)] bg-[var(--surface)] px-5 py-4">
            <div className="min-w-[48px]">
              <p className="font-mono text-[0.5rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">Your rank</p>
              <p className="font-mono text-[1.6rem] font-bold leading-none tracking-[-0.04em] text-[var(--amber-bright)]">
                #{myRankData.rank}
              </p>
            </div>
            <div className="flex-1">
              <p className="flex items-center gap-2 text-[0.9rem] font-semibold text-[var(--text)]">
                {myRankData.displayName}
                <YouBadge />
              </p>
              <p className={`font-mono text-[0.7rem] ${rankMetricColorClass}`}>
                {myRankData.metricLabel}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[0.52rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                {myRankData.sub}
              </p>
            </div>
          </div>
        )}

        <div className="mb-0 flex items-center border-b border-[var(--border)]">
          {[
            { id: 'oracle', label: 'Oracle Score', dotColor: 'var(--amber-bright)' },
            { id: 'netpnl', label: 'Net P&L', dotColor: 'var(--green-bright)' }
          ].map(({ id, label, dotColor }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`mr-7 flex items-center gap-[6px] border-b-2 pb-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] transition-colors ${
                activeTab === id
                  ? 'border-[var(--red)] text-[var(--text)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-dim)]'
              }`}
            >
              <span
                className="inline-block h-[5px] w-[5px] rounded-full"
                style={{ background: dotColor, opacity: activeTab === id ? 1 : 0.4 }}
              />
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-b border-[var(--border)] py-3">
          <div className="font-mono text-[0.56rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
            {activeTab === 'netpnl' && (
              <>
                <strong className="text-[var(--text-dim)]">Net P&L</strong>
                {' '}— portfolio value (cash + positions) minus total deposits. Measures real trading skill.
                <FormulaTooltip formula="Net P&L = (Cash + Open Positions at current price) − Total Deposits" />
              </>
            )}
            {activeTab === 'oracle' && (
              <>
                <strong className="text-[var(--text-dim)]">Oracle Score</strong>
                {' '}— calibration quality across resolved markets, scored from your last market action before resolution.
                <FormulaTooltip formula="How well-calibrated your predictions are. Your final position before each market resolves is scored against the actual outcome — the closer you were, the higher your score. Averaged across all resolved markets. Scale: 0–100." />
              </>
            )}
          </div>
          {activeTab === 'netpnl' && (
            <span className="flex items-center gap-[5px] rounded border border-[var(--border2)] px-2 py-[3px] font-mono text-[0.5rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
              <span className="inline-block h-[5px] w-[5px] animate-pulse rounded-full bg-[var(--green-bright)]" />
              Live
            </span>
          )}
        </div>

        {activeTab === 'netpnl' && (
          <section className="mb-12">
            <table className="w-full overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="w-[48px] px-5 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">#</th>
                  <th className="px-5 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Trader</th>
                  <th className="px-5 py-3 text-right font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Net P&L</th>
                </tr>
              </thead>
              <tbody>
                {netPnlUsers.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-5 py-6 text-center font-mono text-[0.68rem] text-[var(--text-muted)]">
                      No trading activity yet.
                    </td>
                  </tr>
                )}
                {netPnlUsers.map((user, index) => (
                  <tr
                    key={user.id}
                    onClick={() => router.push(`/user/${user.id}`)}
                    className={`cursor-pointer border-b border-[var(--border)] transition-colors last:border-b-0 hover:bg-[var(--surface2)] ${
                      viewer?.uid === user.id ? 'bg-[rgba(220,38,38,.03)]' : ''
                    }`}
                  >
                    <td className="w-[48px] px-5 py-4">
                      <span className={`font-mono text-[0.8rem] font-bold ${rankColorClass(index)}`}>
                        {rankDisplay(index)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--text)]">
                          {getPublicDisplayName(user)}
                        </span>
                        {viewer?.uid === user.id && <YouBadge />}
                      </div>
                      <p className="mt-[2px] font-mono text-[0.52rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                        {positionLabel(user)}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className={`block font-mono text-[0.9rem] font-bold ${
                        Number(user.netPnl || 0) >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'
                      }`}>
                        {Number(user.netPnl || 0) >= 0 ? '+' : '-'}${fmtMoney(Math.abs(Number(user.netPnl || 0)))}
                      </span>
                      <span className="block font-mono text-[0.48rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                        {pctReturn(user)}% return
                      </span>
                      <BarMini
                        value={Math.abs(Number(user.netPnl || 0))}
                        max={maxNetPnl}
                        colorClass={Number(user.netPnl || 0) >= 0 ? 'bg-[var(--green-bright)]' : 'bg-[var(--red)]'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activeTab === 'oracle' && (
          <section className="mb-12">
            <table className="w-full overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="w-[48px] px-5 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">#</th>
                  <th className="px-5 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Forecaster</th>
                  <th className="px-5 py-3 text-right font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Score</th>
                </tr>
              </thead>
              <tbody>
                {oracleUsers.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-5 py-6 text-center font-mono text-[0.68rem] text-[var(--text-muted)]">
                      No oracle scores yet. Scores appear after markets resolve.
                    </td>
                  </tr>
                )}
                {oracleUsers.map((user, index) => (
                  <tr
                    key={user.id}
                    onClick={() => router.push(`/user/${user.id}`)}
                    className={`cursor-pointer border-b border-[var(--border)] transition-colors last:border-b-0 hover:bg-[var(--surface2)] ${
                      viewer?.uid === user.id ? 'bg-[rgba(220,38,38,.03)]' : ''
                    }`}
                  >
                    <td className="w-[48px] px-5 py-4">
                      <span className={`font-mono text-[0.8rem] font-bold ${rankColorClass(index)}`}>
                        {rankDisplay(index)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border2)] bg-[var(--surface2)] font-mono text-[0.52rem] font-bold text-[var(--text-dim)]">
                          {initialsForName(getPublicDisplayName(user))}
                        </span>
                        <span className="text-sm font-semibold text-[var(--text)]">
                          {getPublicDisplayName(user)}
                        </span>
                        {viewer?.uid === user.id && <YouBadge />}
                      </div>
                      <p className="mt-[2px] font-mono text-[0.52rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                        {Number(user.oracleMarketsScored || 0)} markets scored
                      </p>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="block font-mono text-[0.9rem] font-bold text-[var(--amber-bright)]">
                        {Number(user.oracleScore || 0).toFixed(1)} pts
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <PastWeeksSection
          weeklySnapshots={weeklySnapshots}
          expandedWeeks={expandedWeeks}
          setExpandedWeeks={setExpandedWeeks}
        />
      </div>
      <ToastStack toasts={toasts} onDismiss={removeToast} onConfirm={resolveConfirm} />
    </div>
  );
}

function PastWeeksSection({ weeklySnapshots, expandedWeeks, setExpandedWeeks }) {
  return (
    <section className="mb-12">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
          Snapshot Archive
        </span>
        <span className="font-display text-[0.85rem] italic text-[var(--text-dim)]">recent snapshot leaders</span>
      </div>

      <div className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        {weeklySnapshots.length === 0 ? (
          <p className="px-5 py-4 font-mono text-[0.68rem] text-[var(--text-muted)]">
            No snapshots yet.
          </p>
        ) : (
          weeklySnapshots.map((snapshot) => {
            const top = Array.isArray(snapshot.rankings) ? snapshot.rankings[0] : null;
            const topCorrection = Array.isArray(snapshot.rankingsCorrection) ? snapshot.rankingsCorrection[0] : null;
            const expanded = !!expandedWeeks[snapshot.id];
            const weekText = snapshot.weekOf || toDate(snapshot.snapshotDate).toISOString().slice(0, 10);
            const top10 = Array.isArray(snapshot.rankings) ? snapshot.rankings.slice(0, 10) : [];
            const hasWindow = Boolean(snapshot.windowStart && snapshot.windowEnd);
            return (
              <div key={snapshot.id} className="border-b border-[var(--border)] last:border-b-0">
                <button
                  onClick={() => setExpandedWeeks((prev) => ({ ...prev, [snapshot.id]: !prev[snapshot.id] }))}
                  className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-[var(--surface2)]"
                >
                  <div>
                    <p className="font-mono text-[0.66rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Snapshot Date {weekText}</p>
                    <p className="text-sm text-[var(--text)]">
                      Champion: {top?.displayName || '—'} · {top ? `${top.netProfit >= 0 ? '+' : ''}$${fmtMoney(top.netProfit)}` : '—'}
                    </p>
                    {topCorrection && (
                      <p className="mt-1 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--amber-bright)]">
                        Correction leader: {topCorrection.displayName} · {Number(topCorrection.correctionScore || 0).toFixed(1)} pts
                      </p>
                    )}
                  </div>
                  <span className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[var(--text-dim)]">
                    {expanded ? 'Hide Top 10' : 'Show Top 10'}
                  </span>
                </button>
                {expanded && (
                  <div className="px-5 pb-4">
                    <div className="rounded border border-[var(--border)] bg-[var(--surface2)]">
                      {top10.map((entry) => (
                        <div key={`${snapshot.id}-${entry.userId}-${entry.rank}`} className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 last:border-b-0">
                          <span className="font-mono text-[0.65rem] text-[var(--text-muted)]">#{entry.rank}</span>
                          <span className="flex-1 px-3 text-sm text-[var(--text)]">{entry.displayName}</span>
                          <span className={`font-mono text-[0.72rem] ${Number(entry.netProfit || 0) >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
                            {Number(entry.netProfit || 0) >= 0 ? '+' : ''}${fmtMoney(entry.netProfit)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 font-mono text-[0.58rem] text-[var(--text-muted)]">
                      Participants: {snapshot.totalParticipants || 0} · Snapshot: {toDate(snapshot.snapshotDate).toLocaleString()}
                    </p>
                    <p className="mt-1 font-mono text-[0.58rem] text-[var(--text-muted)]">
                      Mode: {snapshot.weeklyMetricMode || 'TRADING_PNL'}
                      {hasWindow ? ` · Window: ${formatWeekWindow(snapshot.windowStart, snapshot.windowEnd)}` : ''}
                    </p>
                    {snapshot.calculationBasis && (
                      <p className="mt-1 font-mono text-[0.58rem] text-[var(--text-muted)]">
                        Basis: {snapshot.calculationBasis.tradingPnl || 'Portfolio value'}{snapshot.calculationBasis.correctionScore ? ` · ${snapshot.calculationBasis.correctionScore}` : ''}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
