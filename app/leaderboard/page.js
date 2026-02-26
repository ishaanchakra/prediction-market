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

function weekLabel(date = new Date()) {
  const start = new Date(date);
  start.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function hoursToNextMonday() {
  const now = new Date();
  const next = new Date(now);
  const day = now.getDay();
  const daysUntilMonday = (8 - (day || 7)) % 7 || 7;
  next.setDate(now.getDate() + daysUntilMonday);
  next.setHours(0, 0, 0, 0);
  const diffMs = next.getTime() - now.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
  return `${days}d ${hours}h`;
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

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function isPermissionDenied(error) {
  return error?.code === 'permission-denied'
    || String(error?.message || '').toLowerCase().includes('missing or insufficient permissions');
}

async function fetchBetsByMarketIds(marketIds) {
  if (marketIds.length === 0) return [];
  const chunks = chunkArray(marketIds, 10);
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

function pctReturn(user) {
  const baseline = Number(user.weeklyStartingBalance || 1000);
  if (baseline === 0) return '0.0';
  const pct = ((Number(user.weeklyNet || 0) / baseline) * 100);
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}`;
}

function positionLabel(user) {
  return Number(user.positionsValue || 0) > 0 ? 'has open positions' : 'no open positions';
}

function joinWeekLabel(user) {
  if (!user.createdAt) return null;
  const semesterStart = new Date('2026-01-19');
  const joined = toDate(user.createdAt);
  const diff = Math.floor((joined - semesterStart) / (7 * 24 * 60 * 60 * 1000));
  const week = Math.max(1, diff + 1);
  return `Joined Wk ${week}`;
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
  const [openMarketsCount, setOpenMarketsCount] = useState(0);
  const [totalTraded, setTotalTraded] = useState(0);
  const [activeTab, setActiveTab] = useState('weekly');
  const { toasts, removeToast, resolveConfirm } = useToastQueue();

  const lifetimeUsers = useMemo(
    () => [...users].sort((a, b) => Number(b.lifetimeRep || 0) - Number(a.lifetimeRep || 0)).slice(0, 50),
    [users]
  );
  const oracleUsers = useMemo(
    () =>
      [...users]
        .filter((u) => Number(u.oracleScore || 0) > 0)
        .sort((a, b) => Number(b.oracleScore || 0) - Number(a.oracleScore || 0))
        .slice(0, 50),
    [users]
  );
  const weeklyUsers = useMemo(
    () =>
      [...weeklyRows]
        .sort((a, b) => Number(b.weeklyNet || 0) - Number(a.weeklyNet || 0))
        .slice(0, 50),
    [weeklyRows]
  );
  const allTimeUsers = useMemo(
    () =>
      [...weeklyRows]
        .sort((a, b) => Number(b.portfolioValue || 0) - Number(a.portfolioValue || 0))
        .slice(0, 50),
    [weeklyRows]
  );

  const meWeekly = useMemo(() => weeklyUsers.find((entry) => entry.id === viewer?.uid), [weeklyUsers, viewer]);
  const meWeeklyRank = useMemo(() => weeklyUsers.findIndex((entry) => entry.id === viewer?.uid), [weeklyUsers, viewer]);
  const topWeekly = weeklyUsers[0];
  const activeTradersCount = useMemo(
    () => weeklyRows.filter((row) => Math.abs(Number(row.weeklyNet || 0)) > 0.001).length,
    [weeklyRows]
  );

  const maxWeeklyNet = useMemo(
    () => Math.max(...weeklyUsers.map((u) => Math.abs(Number(u.weeklyNet || 0))), 1),
    [weeklyUsers]
  );
  const maxLifetimeRep = useMemo(
    () => Math.max(...lifetimeUsers.map((u) => Math.abs(Number(u.lifetimeRep || 0))), 1),
    [lifetimeUsers]
  );
  const maxPortfolioValue = useMemo(
    () => Math.max(...allTimeUsers.map((u) => Number(u.portfolioValue || 0)), 1),
    [allTimeUsers]
  );
  const maxOracleScore = useMemo(
    () => Math.max(...oracleUsers.map((u) => Number(u.oracleScore || 0)), 1),
    [oracleUsers]
  );

  const myRankData = useMemo(() => {
    if (!viewer?.uid) return null;

    if (activeTab === 'weekly') {
      if (!meWeekly || meWeeklyRank < 0) return null;
      return {
        rank: meWeeklyRank + 1,
        displayName: getPublicDisplayName(meWeekly),
        metric: meWeekly.weeklyNet,
        metricLabel: `${meWeekly.weeklyNet >= 0 ? '+' : ''}$${fmtMoney(Math.abs(meWeekly.weeklyNet))}`,
        sub: `${meWeekly.weeklyNet >= 0 ? '+' : ''}${Number(((meWeekly.weeklyNet / Math.max(Number(meWeekly.weeklyStartingBalance || 1000), 1)) * 100)).toFixed(1)}% this week`
      };
    }

    if (activeTab === 'alltime') {
      const idx = allTimeUsers.findIndex((u) => u.id === viewer.uid);
      if (idx < 0) return null;
      const row = allTimeUsers[idx];
      return {
        rank: idx + 1,
        displayName: getPublicDisplayName(row),
        metric: row.portfolioValue,
        metricLabel: `$${fmtMoney(Number(row.portfolioValue || 0))}`,
        sub: 'all-time balance'
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
        sub: 'oracle score'
      };
    }

    return null;
  }, [activeTab, allTimeUsers, oracleUsers, viewer, meWeekly, meWeeklyRank]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => setViewer(currentUser));
    return () => unsubscribe();
  }, []);

  const weekWindow = useMemo(() => getCurrentWeekWindow(), []);
  const rankMetricColorClass = activeTab === 'alltime'
    ? 'text-[var(--amber-bright)]'
    : activeTab === 'oracle'
      ? 'text-[var(--blue-bright)]'
      : (Number(myRankData?.metric || 0) >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]');

  useEffect(() => {
    async function fetchAll() {
      try {
        const usersQ = query(collection(db, 'users'), orderBy('lifetimeRep', 'desc'), limit(300));
        const usersSnap = await getDocs(usersQ);
        const usersData = usersSnap.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
        setUsers(usersData);

        const openQ = query(
          collection(db, 'markets'),
          where('resolution', '==', null),
          where('marketplaceId', '==', null)
        );
        const openSnap = await getDocs(openQ);
        const openMarkets = openSnap.docs
          .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
          .filter((market) => !market.marketplaceId)
          .filter((market) => market.status !== 'CANCELLED');
        setOpenMarketsCount(openMarkets.length);

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
          weeklyNet: round2(row.weeklyNet)
        }));
        setWeeklyRows(weeklyRowsData);

        const allBetsSnap = await getDocs(query(collection(db, 'bets'), where('marketplaceId', '==', null)));
        setTotalTraded(
          round2(allBetsSnap.docs.reduce((sum, snapshotDoc) => {
            const bet = snapshotDoc.data();
            if (bet.marketplaceId) return sum;
            return sum + Math.abs(Number(bet.amount || 0));
          }, 0))
        );

        const snapshotsQ = query(collection(db, 'weeklySnapshots'), orderBy('snapshotDate', 'desc'), limit(12));
        const snapshotsSnap = await getDocs(snapshotsQ);
        setWeeklySnapshots(snapshotsSnap.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
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
  const topLifetime = lifetimeUsers[0];
  const topOracle = oracleUsers[0];

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
            {activeTradersCount} active traders · resets Sunday 11:59pm ET
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
              <p className="text-[0.9rem] font-semibold text-[var(--text)]">
                {myRankData.displayName}
                <span className="ml-2 rounded border border-[rgba(220,38,38,.2)] bg-[var(--red-glow)] px-1.5 py-[0.1rem] font-mono text-[0.44rem] uppercase tracking-[0.08em] text-[var(--red)]">
                  you
                </span>
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
            { id: 'weekly', label: 'This Week', dotColor: 'var(--green-bright)' },
            { id: 'alltime', label: 'All-Time Balance', dotColor: 'var(--amber-bright)' },
            { id: 'oracle', label: 'Oracle Score', dotColor: 'var(--blue-bright)' }
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
            {activeTab === 'weekly' && (
              <>
                <strong className="text-[var(--text-dim)]">Trading P&L</strong>
                {' '}— portfolio value vs. your balance at week start. Resets on Sunday night.
                <FormulaTooltip formula="Weekly P&L = (Cash + Open Positions at current price) − Balance at week start" />
              </>
            )}
            {activeTab === 'alltime' && (
              <>
                <strong className="text-[var(--text-dim)]">All-Time Balance</strong>
                {' '}— cumulative wealth since joining. Early users have a head start; use for personal context.
                <FormulaTooltip formula="Portfolio Value = Cash on hand + (YES shares × current prob) + (NO shares × (1 − current prob))" />
              </>
            )}
            {activeTab === 'oracle' && (
              <>
                <strong className="text-[var(--text-dim)]">Oracle Score</strong>
                {' '}— forecasting accuracy across all resolved markets. Updates on resolution, not trading.
                <FormulaTooltip formula="Oracle Score = Σ net shares × (1 − avg entry price) on winning side, per resolved market" />
              </>
            )}
          </div>
          {activeTab === 'weekly' && (
            <span className="flex items-center gap-[5px] rounded border border-[var(--border2)] px-2 py-[3px] font-mono text-[0.5rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
              <span className="inline-block h-[5px] w-[5px] animate-pulse rounded-full bg-[var(--green-bright)]" />
              Live
            </span>
          )}
        </div>

        {activeTab === 'weekly' && (
          <section className="mb-12">
            <table className="w-full overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="w-[48px] px-5 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">#</th>
                  <th className="px-5 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Trader</th>
                  <th className="px-5 py-3 text-right font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Weekly P&L</th>
                </tr>
              </thead>
              <tbody>
                {weeklyUsers.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-5 py-6 text-center font-mono text-[0.68rem] text-[var(--text-muted)]">
                      No trading activity yet this week.
                    </td>
                  </tr>
                )}
                {weeklyUsers.map((user, index) => (
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
                        Number(user.weeklyNet || 0) >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'
                      }`}>
                        {Number(user.weeklyNet || 0) >= 0 ? '+' : '-'}${fmtMoney(Math.abs(Number(user.weeklyNet || 0)))}
                      </span>
                      <span className="block font-mono text-[0.48rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                        {pctReturn(user)}% this week
                      </span>
                      <BarMini
                        value={Math.abs(Number(user.weeklyNet || 0))}
                        max={maxWeeklyNet}
                        colorClass={Number(user.weeklyNet || 0) >= 0 ? 'bg-[var(--green-bright)]' : 'bg-[var(--red)]'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activeTab === 'alltime' && (
          <section className="mb-12">
            <table className="w-full overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="w-[48px] px-5 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">#</th>
                  <th className="px-5 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Trader</th>
                  <th className="px-5 py-3 text-right font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Balance</th>
                </tr>
              </thead>
              <tbody>
                {allTimeUsers.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-5 py-6 text-center font-mono text-[0.68rem] text-[var(--text-muted)]">
                      No all-time data yet.
                    </td>
                  </tr>
                )}
                {allTimeUsers.map((user, index) => (
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
                      {joinWeekLabel(user) && (
                        <p className="mt-[2px] font-mono text-[0.52rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                          {joinWeekLabel(user)}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="block font-mono text-[0.9rem] font-bold text-[var(--amber-bright)]">
                        ${fmtMoney(Number(user.portfolioValue || 0))}
                      </span>
                      <BarMini
                        value={Number(user.portfolioValue || 0)}
                        max={maxPortfolioValue}
                        colorClass="bg-[var(--amber-bright)]"
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
                        <span className="text-sm font-semibold text-[var(--text)]">
                          {getPublicDisplayName(user)}
                        </span>
                        {viewer?.uid === user.id && <YouBadge />}
                      </div>
                      {/* TODO: surface resolved market count per user once oracleMarketsCount is stored on user docs. */}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="block font-mono text-[0.9rem] font-bold text-[var(--blue-bright)]">
                        {Number(user.oracleScore || 0).toFixed(1)} pts
                      </span>
                      <BarMini
                        value={Number(user.oracleScore || 0)}
                        max={maxOracleScore}
                        colorClass="bg-[var(--blue-bright)]"
                      />
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
          Weekly Archive
        </span>
        <span className="font-display text-[0.85rem] italic text-[var(--text-dim)]">past week champions</span>
      </div>

      <div className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        {weeklySnapshots.length === 0 ? (
          <p className="px-5 py-4 font-mono text-[0.68rem] text-[var(--text-muted)]">
            No weekly snapshots yet. Run weekly reset to capture standings.
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
                    <p className="font-mono text-[0.66rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Week Of {weekText}</p>
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
