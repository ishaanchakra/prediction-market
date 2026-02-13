'use client';
import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { getPublicDisplayName } from '@/utils/displayName';
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

export default function LeaderboardPage() {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState(null);
  const [openMarketsCount, setOpenMarketsCount] = useState(0);
  const [totalTraded, setTotalTraded] = useState(0);
  const { toasts, removeToast, resolveConfirm } = useToastQueue();

  const weeklyUsers = useMemo(
    () => [...users].sort((a, b) => Number(b.weeklyRep || 0) - Number(a.weeklyRep || 0)).slice(0, 50),
    [users]
  );
  const lifetimeUsers = useMemo(
    () => [...users].sort((a, b) => Number(b.lifetimeRep || 0) - Number(a.lifetimeRep || 0)).slice(0, 50),
    [users]
  );

  const meWeekly = useMemo(() => weeklyUsers.find((entry) => entry.id === viewer?.uid), [weeklyUsers, viewer]);
  const meWeeklyRank = useMemo(() => weeklyUsers.findIndex((entry) => entry.id === viewer?.uid), [weeklyUsers, viewer]);
  const topWeekly = weeklyUsers[0];

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => setViewer(currentUser));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function fetchAll() {
      try {
        const usersQ = query(collection(db, 'users'), orderBy('lifetimeRep', 'desc'), limit(300));
        const userSnap = await getDocs(usersQ);
        setUsers(userSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

        const openQ = query(collection(db, 'markets'), orderBy('createdAt', 'desc'), limit(200));
        const openSnap = await getDocs(openQ);
        const open = openSnap.docs.filter((d) => d.data().resolution == null && d.data().status !== 'CANCELLED').length;
        setOpenMarketsCount(open);

        const betsSnap = await getDocs(collection(db, 'bets'));
        setTotalTraded(
          betsSnap.docs.reduce((sum, d) => sum + Math.abs(Number(d.data().amount || 0)), 0)
        );
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
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
            Week {weekLabel()} · resets every Monday at midnight
          </p>
        </div>

        <div className="mb-8 flex items-center justify-between overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-6 py-4">
          <div>
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">Current Week</p>
            <p className="text-base font-bold text-[var(--text)]">Week of {weekLabel()}</p>
            <p className="font-mono text-[0.65rem] text-[var(--text-dim)]">All traders start at $1,000.00</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-bold tracking-[-0.03em] text-[var(--amber-bright)]">{hoursToNextMonday()}</p>
            <p className="font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">until reset</p>
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
              <p className="font-mono text-[0.62rem] text-[var(--text-dim)]">Weekly performance snapshot</p>
            </div>
            <p className="text-right font-mono text-4xl font-bold tracking-[-0.04em] text-[var(--green-bright)]">#{meWeeklyRank + 1}</p>
            <p className="text-right font-mono text-[0.65rem] text-[var(--text-dim)]">Weekly P&L: <strong className={(Number(meWeekly.weeklyRep || 0) - 1000) >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}>{(Number(meWeekly.weeklyRep || 0) - 1000) >= 0 ? '+' : ''}${fmtMoney(Number(meWeekly.weeklyRep || 0) - 1000)}</strong></p>
          </div>
        )}

        <div className="mb-8 grid grid-cols-4 gap-[1px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--border)]">
          <StatCell label="Active Traders" value={`${users.length}`} tone="amber" />
          <StatCell label="Total Traded" value={`$${Math.round(totalTraded).toLocaleString()}`} tone="dim" />
          <StatCell label="Markets Open" value={`${openMarketsCount}`} tone="red" />
          <StatCell label="Top Profit" value={`${(Number(topWeekly?.weeklyRep || 1000) - 1000) >= 0 ? '+' : ''}$${Math.round(Number(topWeekly?.weeklyRep || 1000) - 1000)}`} tone="green" />
        </div>

        <TableBlock
          title="Weekly Rankings"
          subtitle="traders of the week"
          users={weeklyUsers}
          viewerId={viewer?.uid}
          router={router}
          metricFn={(u) => Number(u.weeklyRep || 0) - 1000}
          betsLabelFn={() => ''}
        />

        <TableBlock
          title="All-Time Rankings"
          subtitle="the oracles of ithaca"
          users={lifetimeUsers}
          viewerId={viewer?.uid}
          router={router}
          metricFn={(u) => Number(u.lifetimeRep || 0)}
          lifetime
          betsLabelFn={() => ''}
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

function TableBlock({ title, subtitle, users, viewerId, router, metricFn, lifetime = false }) {
  const maxAbs = Math.max(...users.map((u) => Math.abs(metricFn(u))), 1);
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
            <th className="px-5 py-3 text-right font-mono text-[0.58rem] uppercase tracking-[0.1em] font-normal text-[var(--text-muted)]">{lifetime ? 'Net Profit (All-Time)' : 'Net Profit (Week)'}</th>
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
                    <span className="text-sm font-semibold text-[var(--text)]">
                      {getPublicDisplayName(user)}
                    </span>
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
                </td>
                <td className="px-5 py-4 text-right">
                  <span className={`block font-mono text-[0.9rem] font-bold ${pos ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
                    {pos ? '+' : '-'}${fmtMoney(Math.abs(profit))}
                  </span>
                  <span className="ml-auto mt-1 block h-[2px] w-20 rounded bg-[var(--surface3)]">
                    <span
                      className={`block h-[2px] rounded ${pos ? 'bg-[var(--green-bright)]' : 'bg-[var(--red)]'}`}
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
