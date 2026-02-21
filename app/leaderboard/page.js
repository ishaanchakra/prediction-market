'use client';
import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { getPublicDisplayName } from '@/utils/displayName';
import { round2 } from '@/utils/round';
import { calculateAllPortfolioValues } from '@/utils/portfolio';
import { calculateWeeklyCorrectionRows } from '@/utils/weeklyCorrection';
import { ANALYTICS_EVENTS, trackEvent } from '@/utils/analytics';
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
  const [allTimeMode, setAllTimeMode] = useState('pnl');
  const [weeklyMode, setWeeklyMode] = useState('pnl');
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
  const weeklyRowsWithModes = useMemo(
    () =>
      weeklyRows.map((row) => ({
        ...row,
        weeklyCorrectionScore: Number(row.weeklyCorrectionScore || 0),
        weeklyResolvedMarkets: Number(row.weeklyResolvedMarkets || 0)
      })),
    [weeklyRows]
  );

  const weeklyUsers = useMemo(() => {
    const sorted = [...weeklyRowsWithModes].sort((a, b) => {
      if (weeklyMode === 'correction') {
        const scoreDiff = Number(b.weeklyCorrectionScore || 0) - Number(a.weeklyCorrectionScore || 0);
        if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
      }
      return Number(b.portfolioValue || 0) - Number(a.portfolioValue || 0);
    });
    return sorted.slice(0, 50);
  }, [weeklyMode, weeklyRowsWithModes]);

  const meWeekly = useMemo(() => weeklyUsers.find((entry) => entry.id === viewer?.uid), [weeklyUsers, viewer]);
  const meWeeklyRank = useMemo(() => weeklyUsers.findIndex((entry) => entry.id === viewer?.uid), [weeklyUsers, viewer]);
  const topWeekly = weeklyUsers[0];
  const activeTradersCount = useMemo(
    () => weeklyRows.filter((row) => Math.abs(Number(row.weeklyNet || 0)) > 0.001).length,
    [weeklyRows]
  );
  const correctionParticipants = useMemo(
    () => weeklyRowsWithModes.filter((row) => Number(row.weeklyResolvedMarkets || 0) > 0).length,
    [weeklyRowsWithModes]
  );

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => setViewer(currentUser));
    return () => unsubscribe();
  }, []);

  const weekWindow = useMemo(() => getCurrentWeekWindow(), []);
  const weeklyModeCopy = weeklyMode === 'correction'
    ? 'Correction score rewards correct, contrarian positions on markets resolved this week.'
    : 'Trading P&L uses portfolio value (cash + open positions) from a $1,000 baseline.';
  const weeklyModeDetail = weeklyMode === 'correction'
    ? `Window ${formatWeekWindow(weekWindow.start, weekWindow.end)} · ${correctionParticipants} users scored`
    : `Window ${formatWeekWindow(weekWindow.start, weekWindow.end)} · ${activeTradersCount} active traders`;

  function handleWeeklyModeChange(nextMode) {
    if (nextMode === weeklyMode) return;
    setWeeklyMode(nextMode);
    trackEvent(ANALYTICS_EVENTS.LEADERBOARD_MODE_TOGGLED, {
      mode: nextMode,
      weekStart: weekWindow.start.toISOString(),
      weekEnd: weekWindow.end.toISOString()
    });
  }

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

        const weekWindow = getCurrentWeekWindow();
        const [resolvedYesSnap, resolvedNoSnap] = await Promise.all([
          getDocs(query(
            collection(db, 'markets'),
            where('marketplaceId', '==', null),
            where('resolution', '==', 'YES')
          )),
          getDocs(query(
            collection(db, 'markets'),
            where('marketplaceId', '==', null),
            where('resolution', '==', 'NO')
          ))
        ]);
        const resolvedThisWeek = [...resolvedYesSnap.docs, ...resolvedNoSnap.docs]
          .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
          .filter((market) => !market.marketplaceId)
          .filter((market) => market.status !== 'CANCELLED')
          .filter((market) => {
            const resolvedAt = toDate(market.resolvedAt).getTime();
            return resolvedAt >= weekWindow.start.getTime() && resolvedAt < weekWindow.end.getTime();
          });
        const resolvedMarketIds = resolvedThisWeek.map((market) => market.id);
        const resolvedBets = await fetchBetsByMarketIds(resolvedMarketIds);
        const correctionRows = calculateWeeklyCorrectionRows({
          users: usersData,
          resolvedMarkets: resolvedThisWeek,
          bets: resolvedBets
        });
        const correctionByUserId = correctionRows.reduce((acc, row) => {
          acc[row.id] = row;
          return acc;
        }, {});

        const weeklyRowsData = calculateAllPortfolioValues({
          users: usersData,
          bets: openBets,
          openMarkets
        }).map((row) => ({
          ...row,
          portfolioValue: round2(row.portfolioValue),
          cashBalance: round2(row.cashBalance),
          positionsValue: round2(row.positionsValue),
          weeklyNet: round2(row.weeklyNet),
          weeklyCorrectionScore: round2(correctionByUserId[row.id]?.weeklyCorrectionScore || 0),
          weeklyResolvedMarkets: Number(correctionByUserId[row.id]?.weeklyResolvedMarkets || 0)
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

  return (
    <div className="min-h-screen bg-[var(--bg)] px-8 py-12">
      <div className="mx-auto max-w-[1000px]">
        <div className="mb-12">
          <p className="mb-3 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[var(--red)]">
            <span className="inline-block h-px w-5 bg-[var(--red)]" />
            Season Rankings
          </p>
          <h1 className="mb-2 font-display text-5xl leading-[1.05] tracking-[-0.02em] text-[var(--text)]">
            The <em className="text-[var(--red)]">Oracles</em> of Ithaca
          </h1>
          <p className="font-mono text-[0.7rem] text-[var(--text-dim)]">
            Week {weekLabel()} · next reset window {hoursToNextMonday()}
          </p>
        </div>

        <div className="mb-8 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">Current Week</p>
              <p className="text-base font-bold text-[var(--text)]">Week of {weekLabel()}</p>
              <p className="font-mono text-[0.65rem] text-[var(--text-dim)]">{weeklyModeCopy}</p>
              <p className="mt-1 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">{weeklyModeDetail}</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-2xl font-bold tracking-[-0.03em] text-[var(--amber-bright)]">{hoursToNextMonday()}</p>
              <p className="font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">until reset window</p>
            </div>
          </div>
          <div className="mt-4 inline-flex rounded border border-[var(--border2)] bg-[var(--surface2)] p-1">
            <button
              onClick={() => handleWeeklyModeChange('pnl')}
              className={`rounded px-3 py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] ${
                weeklyMode === 'pnl' ? 'bg-[var(--red-glow)] text-[var(--red)]' : 'text-[var(--text-muted)] hover:text-[var(--text-dim)]'
              }`}
            >
              Trading P&L
            </button>
            <button
              onClick={() => handleWeeklyModeChange('correction')}
              className={`rounded px-3 py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] ${
                weeklyMode === 'correction' ? 'bg-[rgba(217,119,6,.12)] text-[var(--amber-bright)]' : 'text-[var(--text-muted)] hover:text-[var(--text-dim)]'
              }`}
            >
              Correction Score
            </button>
          </div>
        </div>

        {viewer && meWeekly && (
          <div className="relative mb-8 grid grid-cols-[auto_1fr_auto_auto] items-center gap-5 overflow-hidden rounded-[8px] border border-[var(--red-dim)] bg-[var(--surface)] px-6 py-5">
            <span className="absolute bottom-0 left-0 top-0 w-[3px] bg-[var(--red)]" />
            <span className="rounded border border-[rgba(220,38,38,.2)] bg-[var(--red-glow)] px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-[var(--red)]">
              You
            </span>
            <div>
              <p className="text-base font-bold text-[var(--text)]">{getPublicDisplayName(meWeekly)}</p>
              <p className="font-mono text-[0.62rem] text-[var(--text-dim)]">
                {weeklyMode === 'correction'
                  ? `${Number(meWeekly.weeklyResolvedMarkets || 0)} resolved market${Number(meWeekly.weeklyResolvedMarkets || 0) === 1 ? '' : 's'} scored`
                  : `Cash $${fmtMoney(meWeekly.cashBalance)} · Positions $${fmtMoney(meWeekly.positionsValue)}`}
              </p>
            </div>
            <p className="text-right font-mono text-4xl font-bold tracking-[-0.04em] text-[var(--green-bright)]">#{meWeeklyRank + 1}</p>
            <p className="text-right font-mono text-[0.65rem] text-[var(--text-dim)]">
              {weeklyMode === 'correction' ? 'Correction Score' : 'Weekly P&L'}:{' '}
              <strong className={weeklyMode === 'correction'
                ? 'text-[var(--amber-bright)]'
                : (Number(meWeekly.weeklyNet || 0) >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]')}
              >
                {weeklyMode === 'correction'
                  ? `${Number(meWeekly.weeklyCorrectionScore || 0).toFixed(1)} pts`
                  : `${Number(meWeekly.weeklyNet || 0) >= 0 ? '+' : ''}$${fmtMoney(meWeekly.weeklyNet)}`}
              </strong>
            </p>
          </div>
        )}

        <div className="mb-8 grid grid-cols-4 gap-[1px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--border)]">
          <StatCell label="Active Traders" value={`${activeTradersCount}`} tone="amber" />
          <StatCell label="Total Traded" value={`$${Math.round(totalTraded).toLocaleString()}`} tone="dim" />
          <StatCell label="Markets Open" value={`${openMarketsCount}`} tone="red" />
          <StatCell
            label={weeklyMode === 'correction' ? 'Top Score' : 'Top Profit'}
            value={weeklyMode === 'correction'
              ? `${Number(topWeekly?.weeklyCorrectionScore || 0).toFixed(1)} pts`
              : `${(Number(topWeekly?.weeklyNet || 0)) >= 0 ? '+' : ''}$${Math.round(Number(topWeekly?.weeklyNet || 0))}`}
            tone={weeklyMode === 'correction' ? 'amber' : 'green'}
          />
        </div>

        <TableBlock
          title={weeklyMode === 'correction' ? 'Weekly Correction Rankings' : 'Weekly Trading Rankings'}
          subtitle={weeklyMode === 'correction' ? 'truth-seeking performance' : 'traders of the week'}
          users={weeklyUsers}
          viewerId={viewer?.uid}
          router={router}
          metricFn={(user) => (weeklyMode === 'correction' ? Number(user.weeklyCorrectionScore || 0) : Number(user.weeklyNet || 0))}
          detailsFn={(user) =>
            weeklyMode === 'correction'
              ? `${Number(user.weeklyResolvedMarkets || 0)} resolved market${Number(user.weeklyResolvedMarkets || 0) === 1 ? '' : 's'} scored`
              : `Portfolio $${fmtMoney(user.portfolioValue)} · Cash $${fmtMoney(user.cashBalance)} · Pos $${fmtMoney(user.positionsValue)}`}
          metricLabel={weeklyMode === 'correction' ? 'Correction Score' : 'Net Profit (Week)'}
          metricDisplayFn={(value) =>
            weeklyMode === 'correction'
              ? `${Number(value || 0).toFixed(1)} pts`
              : `${Number(value || 0) >= 0 ? '+' : '-'}$${fmtMoney(Math.abs(Number(value || 0)))}`}
          metricClassFn={(value) => {
            if (weeklyMode === 'correction') return 'text-[var(--amber-bright)]';
            return Number(value || 0) >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]';
          }}
          barClassFn={(value) => {
            if (weeklyMode === 'correction') return 'bg-[var(--amber-bright)]';
            return Number(value || 0) >= 0 ? 'bg-[var(--green-bright)]' : 'bg-[var(--red)]';
          }}
        />

        <AllTimeSection
          allTimeMode={allTimeMode}
          setAllTimeMode={setAllTimeMode}
          lifetimeUsers={lifetimeUsers}
          oracleUsers={oracleUsers}
          viewerId={viewer?.uid}
          router={router}
        />

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

function StatCell({ label, value, tone }) {
  const toneClass = tone === 'amber'
    ? 'text-[var(--amber-bright)]'
    : tone === 'red'
      ? 'text-[var(--red)]'
      : tone === 'green'
        ? 'text-[var(--green-bright)]'
        : 'text-[var(--text-dim)]';
  return (
    <div className="bg-[var(--surface)] px-5 py-4">
      <p className="mb-1 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}</p>
      <p className={`font-mono text-[1.3rem] font-bold tracking-[-0.03em] ${toneClass}`}>{value}</p>
    </div>
  );
}

function TableBlock({
  title,
  subtitle,
  users,
  viewerId,
  router,
  metricFn,
  detailsFn,
  lifetime = false,
  metricLabel,
  metricDisplayFn,
  metricClassFn,
  barClassFn
}) {
  const maxAbs = Math.max(...users.map((user) => Math.abs(metricFn(user))), 1);
  return (
    <section className="mb-12">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
          {title}
        </span>
        <span className="font-display text-[0.85rem] italic text-[var(--text-dim)]">{subtitle}</span>
      </div>

      <table className="w-full overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="px-5 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Rank</th>
            <th className="px-5 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Trader</th>
            <th className="px-5 py-3 text-right font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">
              {metricLabel || (lifetime ? 'Net Profit (All-Time)' : 'Net Profit (Week)')}
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user, index) => {
            const profit = metricFn(user);
            const pos = profit >= 0;
            const barWidth = Math.max(2, Math.round((Math.abs(profit) / maxAbs) * 80));
            const rankText = lifetime && index === 0 ? '🔮' : String(index + 1).padStart(2, '0');
            const rankColor = index === 0
              ? 'text-[var(--amber-bright)]'
              : index === 1
                ? 'text-[#9ca3af]'
                : index === 2
                  ? 'text-[#b45309]'
                  : 'text-[var(--text)]';

            return (
              <tr
                key={user.id}
                onClick={() => router.push(`/user/${user.id}`)}
                className={`cursor-pointer border-b border-[var(--border)] transition-colors last:border-b-0 hover:bg-[var(--surface2)] ${viewerId === user.id ? 'bg-[rgba(220,38,38,.04)]' : ''}`}
              >
                <td className="px-5 py-4">
                  <span className={`font-mono text-[0.8rem] font-bold ${rankColor}`}>{rankText}</span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text)]">{getPublicDisplayName(user)}</span>
                    {viewerId === user.id && (
                      <span className="rounded border border-[rgba(220,38,38,.2)] bg-[var(--red-glow)] px-1.5 py-[0.1rem] font-mono text-[0.55rem] uppercase tracking-[0.08em] text-[var(--red)]">
                        you
                      </span>
                    )}
                    {lifetime && index === 0 && (
                      <span className="rounded border border-[rgba(217,119,6,.2)] bg-[rgba(217,119,6,.1)] px-1.5 py-[0.1rem] font-mono text-[0.55rem] uppercase tracking-[0.08em] text-[var(--amber-bright)]">
                        oracle
                      </span>
                    )}
                  </div>
                  {!!detailsFn(user) && (
                    <p className="mt-1 font-mono text-[0.58rem] text-[var(--text-muted)]">{detailsFn(user)}</p>
                  )}
                </td>
                <td className="px-5 py-4 text-right">
                  <span className={`block font-mono text-[0.9rem] font-bold ${metricClassFn ? metricClassFn(profit) : (pos ? 'text-[var(--green-bright)]' : 'text-[var(--red)]')}`}>
                    {metricDisplayFn ? metricDisplayFn(profit) : `${pos ? '+' : '-'}$${fmtMoney(Math.abs(profit))}`}
                  </span>
                  <span className="ml-auto mt-1 block h-[2px] w-20 rounded bg-[var(--surface3)]">
                    <span
                      className={`block h-[2px] rounded ${barClassFn ? barClassFn(profit) : (pos ? 'bg-[var(--green-bright)]' : 'bg-[var(--red)]')}`}
                      style={{ width: `${barWidth}px` }}
                    />
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

function AllTimeSection({ allTimeMode, setAllTimeMode, lifetimeUsers, oracleUsers, viewerId, router }) {
  const isPnl = allTimeMode === 'pnl';
  const activeUsers = isPnl ? lifetimeUsers : oracleUsers;
  const maxScore = Math.max(...oracleUsers.map((u) => Number(u.oracleScore || 0)), 1);
  const maxPnl = Math.max(...lifetimeUsers.map((u) => Math.abs(Number(u.lifetimeRep || 0))), 1);

  return (
    <section className="mb-12">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
          All-Time Rankings
        </span>
        <span className="font-display text-[0.85rem] italic text-[var(--text-dim)]">the oracles of ithaca</span>
      </div>

      {/* Mode toggle tabs */}
      <div className="mb-3 flex items-center gap-4 border-b border-[var(--border)]">
        <button
          onClick={() => setAllTimeMode('pnl')}
          className={`pb-2 font-mono text-[0.62rem] uppercase tracking-[0.12em] transition-colors ${
            isPnl
              ? 'border-b-2 border-[var(--red)] text-[var(--red)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-dim)]'
          }`}
        >
          Lifetime P&L
        </button>
        <button
          onClick={() => setAllTimeMode('oracle')}
          className={`pb-2 font-mono text-[0.62rem] uppercase tracking-[0.12em] transition-colors ${
            !isPnl
              ? 'border-b-2 border-[var(--red)] text-[var(--red)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-dim)]'
          }`}
        >
          Oracle Score
        </button>
      </div>

      {!isPnl && (
        <p className="mb-3 font-mono text-[0.65rem] text-[var(--text-dim)]">
          Rewards correct predictions, weighted by conviction and how contrarian you were at entry.
        </p>
      )}

      <table className="w-full overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="px-5 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Rank</th>
            <th className="px-5 py-3 text-left font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">Trader</th>
            <th className="px-5 py-3 text-right font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">
              {isPnl ? 'Net Profit (All-Time)' : 'Oracle Score'}
            </th>
          </tr>
        </thead>
        <tbody>
          {activeUsers.length === 0 && (
            <tr>
              <td colSpan={3} className="px-5 py-6 font-mono text-[0.68rem] text-[var(--text-muted)] text-center">
                {isPnl ? 'No lifetime data yet.' : 'No oracle scores yet. Scores appear after markets resolve.'}
              </td>
            </tr>
          )}
          {activeUsers.map((user, index) => {
            const rankText = index === 0 ? '🔮' : String(index + 1).padStart(2, '0');
            const rankColor = index === 0
              ? 'text-[var(--amber-bright)]'
              : index === 1
                ? 'text-[#9ca3af]'
                : index === 2
                  ? 'text-[#b45309]'
                  : 'text-[var(--text)]';

            return (
              <tr
                key={user.id}
                onClick={() => router.push(`/user/${user.id}`)}
                className={`cursor-pointer border-b border-[var(--border)] transition-colors last:border-b-0 hover:bg-[var(--surface2)] ${viewerId === user.id ? 'bg-[rgba(220,38,38,.04)]' : ''}`}
              >
                <td className="px-5 py-4">
                  <span className={`font-mono text-[0.8rem] font-bold ${rankColor}`}>{rankText}</span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text)]">{getPublicDisplayName(user)}</span>
                    {viewerId === user.id && (
                      <span className="rounded border border-[rgba(220,38,38,.2)] bg-[var(--red-glow)] px-1.5 py-[0.1rem] font-mono text-[0.55rem] uppercase tracking-[0.08em] text-[var(--red)]">
                        you
                      </span>
                    )}
                    {index === 0 && !isPnl && (
                      <span className="rounded border border-[rgba(217,119,6,.2)] bg-[rgba(217,119,6,.1)] px-1.5 py-[0.1rem] font-mono text-[0.55rem] uppercase tracking-[0.08em] text-[var(--amber-bright)]">
                        oracle
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-4 text-right">
                  {isPnl ? (
                    <>
                      <span className={`block font-mono text-[0.9rem] font-bold ${Number(user.lifetimeRep || 0) >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
                        {Number(user.lifetimeRep || 0) >= 0 ? '+' : '-'}${fmtMoney(Math.abs(Number(user.lifetimeRep || 0)))}
                      </span>
                      <span className="ml-auto mt-1 block h-[2px] w-20 rounded bg-[var(--surface3)]">
                        <span
                          className={`block h-[2px] rounded ${Number(user.lifetimeRep || 0) >= 0 ? 'bg-[var(--green-bright)]' : 'bg-[var(--red)]'}`}
                          style={{ width: `${Math.max(2, Math.round((Math.abs(Number(user.lifetimeRep || 0)) / maxPnl) * 80))}px` }}
                        />
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="block font-mono text-[0.9rem] font-bold text-[var(--amber-bright)]">
                        {Number(user.oracleScore || 0).toFixed(1)} pts
                      </span>
                      <span className="ml-auto mt-1 block h-[2px] w-20 rounded bg-[var(--surface3)]">
                        <span
                          className="block h-[2px] rounded bg-[var(--amber-bright)]"
                          style={{ width: `${Math.max(2, Math.round((Number(user.oracleScore || 0) / maxScore) * 80))}px` }}
                        />
                      </span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function PastWeeksSection({ weeklySnapshots, expandedWeeks, setExpandedWeeks }) {
  return (
    <section className="mb-12">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="flex items-center gap-[0.6rem] font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
          Past Weeks
        </span>
        <span className="font-display text-[0.85rem] italic text-[var(--text-dim)]">weekly snapshot archive</span>
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
