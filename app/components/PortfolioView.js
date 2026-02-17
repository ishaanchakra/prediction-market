'use client';

import Link from 'next/link';
import { aggregatePositions, calculatePortfolioSummary } from '@/utils/portfolio';
import { MARKET_STATUS } from '@/utils/marketStatus';
import { round2 } from '@/utils/round';

function fmtMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function sectionLabel(text, subtitle) {
  return (
    <div className="mb-4">
      <p className="flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
        <span className="inline-block h-px w-[14px] bg-[var(--red)]" />
        {text}
      </p>
      {subtitle ? <p className="mt-1 font-display text-[0.85rem] italic text-[var(--text-dim)]">{subtitle}</p> : null}
    </div>
  );
}

function categoryLabel(category) {
  const map = {
    sports: 'Sports',
    campus: 'Campus Life',
    academic: 'Academics',
    admin: 'Admin & Policy',
    wildcard: 'Wildcard'
  };
  return map[category] || 'Wildcard';
}

function sideBadgeClasses(side) {
  if (side === 'YES') return 'border-[rgba(34,197,94,.25)] bg-[rgba(34,197,94,.12)] text-[var(--green-bright)]';
  if (side === 'NO') return 'border-[rgba(220,38,38,.25)] bg-[var(--red-glow)] text-[var(--red)]';
  return 'border-[var(--border2)] bg-[var(--surface3)] text-[var(--text-dim)]';
}

function outcomeBadge(position) {
  if (position.marketStatus === MARKET_STATUS.CANCELLED) {
    return { label: 'Refund', cls: 'border-[var(--border2)] bg-[var(--surface3)] text-[var(--text-dim)]' };
  }
  if (position.marketStatus !== MARKET_STATUS.RESOLVED) {
    return { label: 'Open', cls: 'border-[var(--border2)] bg-[var(--surface3)] text-[var(--text-dim)]' };
  }

  const won =
    (position.marketResolution === 'YES' && position.yesShares > position.noShares)
    || (position.marketResolution === 'NO' && position.noShares > position.yesShares);

  if (won) return { label: 'Won', cls: 'border-[rgba(34,197,94,.25)] bg-[rgba(34,197,94,.12)] text-[var(--green-bright)]' };
  return { label: 'Lost', cls: 'border-[rgba(220,38,38,.25)] bg-[var(--red-glow)] text-[var(--red)]' };
}

export default function PortfolioView({ userId, user, bets, isOwnProfile }) {
  const positions = aggregatePositions(bets || []);

  const activePositions = positions
    .filter((pos) => [MARKET_STATUS.OPEN, MARKET_STATUS.LOCKED].includes(pos.marketStatus))
    .sort((a, b) => b.marketValue - a.marketValue);

  const closedPositions = positions
    .filter((pos) => [MARKET_STATUS.RESOLVED, MARKET_STATUS.CANCELLED].includes(pos.marketStatus))
    .sort((a, b) => (b.resolvedDate || '').localeCompare(a.resolvedDate || ''));

  const summary = calculatePortfolioSummary(user, activePositions);

  const closedResolved = closedPositions.filter((pos) => pos.marketStatus === MARKET_STATUS.RESOLVED);
  const wins = closedResolved.filter((pos) => outcomeBadge(pos).label === 'Won').length;
  const winRate = closedResolved.length > 0 ? round2((wins / closedResolved.length) * 100) : 0;

  const tradeCount = (bets || []).length;
  const joinedDate = user?.createdAt?.toDate?.()
    ? user.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : 'Unknown';

  const total = Math.max(summary.portfolioValue, 1);
  const cashWidth = `${Math.max(0, Math.min(100, (summary.cashBalance / total) * 100))}%`;
  const yesWidth = `${Math.max(0, Math.min(100, (summary.yesExposure / total) * 100))}%`;
  const noWidth = `${Math.max(0, Math.min(100, (summary.noExposure / total) * 100))}%`;

  return (
    <div className="space-y-8">
      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Meta label="Profile" value={isOwnProfile ? 'Your Portfolio' : 'Public Portfolio'} />
          <Meta label="Member Since" value={joinedDate} />
          <Meta label="Trades" value={String(tradeCount)} />
          <Meta label="Win Rate" value={`${winRate}%`} />
        </div>
      </div>

      <div>
        {sectionLabel('Portfolio Overview', 'Cash + mark-to-market value of active positions')}
        <div className="grid grid-cols-2 gap-[1px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--border)] lg:grid-cols-4">
          <MetricCell label="Portfolio Value" value={fmtMoney(summary.portfolioValue)} tone="text-[var(--amber-bright)]" />
          <MetricCell label="Weekly P&L" value={`${summary.weeklyPnl >= 0 ? '+' : '-'}${fmtMoney(Math.abs(summary.weeklyPnl)).slice(1)}`} tone={summary.weeklyPnl >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'} />
          <MetricCell label="Cash Available" value={fmtMoney(summary.cashBalance)} tone="text-[var(--text)]" />
          <MetricCell label="In Positions" value={fmtMoney(summary.positionsValue)} tone="text-[var(--text-dim)]" />
        </div>
      </div>

      <div>
        {sectionLabel('Allocation', 'Current weekly portfolio exposure')}
        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="h-[6px] overflow-hidden rounded-[3px] bg-[var(--surface3)]">
            <div className="h-full" style={{ width: cashWidth, background: 'var(--amber-bright)', float: 'left' }} />
            <div className="h-full" style={{ width: yesWidth, background: 'var(--green-bright)', float: 'left' }} />
            <div className="h-full" style={{ width: noWidth, background: 'var(--red)', float: 'left' }} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[0.7rem] font-mono text-[var(--text-dim)]">
            <LegendDot color="var(--amber-bright)" label={`Cash ${round2(summary.cashPct)}%`} />
            <LegendDot color="var(--green-bright)" label={`YES ${round2(summary.yesPct)}%`} />
            <LegendDot color="var(--red)" label={`NO ${round2(summary.noPct)}%`} />
            <span className="text-[var(--text-muted)]">{summary.marketCount} active markets</span>
          </div>
        </div>
      </div>

      <div>
        {sectionLabel('Active Positions', 'Grouped by market, not individual trades')}
        {activePositions.length === 0 ? (
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center font-mono text-[0.68rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
            No active positions
          </div>
        ) : (
          <div className="space-y-3">
            {activePositions.map((position) => {
              const probPct = round2(position.marketProbability * 100);
              const dominantShares = position.side === 'NO' ? position.noShares : position.yesShares;
              const accent =
                position.side === 'YES'
                  ? 'bg-[var(--green-bright)]'
                  : position.side === 'NO'
                    ? 'bg-[var(--red)]'
                    : 'bg-gradient-to-b from-[var(--green-bright)] to-[var(--red)]';
              const fillColor = probPct > 65 ? 'var(--green-bright)' : probPct < 35 ? 'var(--red)' : 'var(--amber-bright)';

              return (
                <Link
                  key={position.marketId}
                  href={`/market/${position.marketId}`}
                  className="grid grid-cols-[3px_1fr] overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--surface)] transition-colors hover:bg-[var(--surface2)] hover:border-[var(--border2)]"
                >
                  <div className={accent} />
                  <div className="p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-[3px] border border-[var(--border2)] bg-[var(--surface3)] px-2 py-[0.2rem] font-mono text-[0.5rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                        {categoryLabel(position.marketCategory)}
                      </span>
                      <span className={`rounded-[3px] border px-2 py-[0.2rem] font-mono text-[0.5rem] uppercase tracking-[0.08em] ${sideBadgeClasses(position.side)}`}>
                        {position.side}
                      </span>
                    </div>

                    <p className="mb-3 text-[0.9rem] font-semibold text-[var(--text)]">{position.marketQuestion}</p>

                    <div className="grid grid-cols-2 gap-x-5 gap-y-3 text-[0.75rem] sm:grid-cols-4">
                      <Metric label="Net Shares" value={round2(dominantShares).toFixed(2)} />
                      <Metric label="Cost Basis" value={fmtMoney(position.totalCost)} tone="text-[var(--amber-bright)]" />
                      <Metric label="Mkt Value" value={fmtMoney(position.marketValue)} />
                      <Metric
                        label="Unrealized"
                        value={`${position.unrealizedPnl >= 0 ? '+' : '-'}${fmtMoney(Math.abs(position.unrealizedPnl)).slice(1)} (${position.unrealizedPnlPct >= 0 ? '+' : ''}${round2(position.unrealizedPnlPct)}%)`}
                        tone={position.unrealizedPnl >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}
                      />
                    </div>

                    <div className="mt-3 hidden items-center gap-2 sm:flex">
                      <span className="font-mono text-[0.55rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Prob</span>
                      <div className="h-[4px] w-[48px] overflow-hidden rounded-[3px] bg-[var(--surface3)]">
                        <div className="h-full" style={{ width: `${probPct}%`, background: fillColor }} />
                      </div>
                      <span className="font-mono text-[0.66rem] text-[var(--text-dim)]">{probPct}%</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div>
        {sectionLabel('Closed Positions', 'Resolved and refunded positions')}
        {closedPositions.length === 0 ? (
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center font-mono text-[0.68rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
            No closed positions
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
            <table className="min-w-full text-left">
              <thead className="border-b border-[var(--border)] bg-[var(--surface2)]">
                <tr className="font-mono text-[0.56rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  <th className="px-4 py-3">Market</th>
                  <th className="px-4 py-3">Side</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Resolved</th>
                  <th className="px-4 py-3 text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {closedPositions.map((position) => {
                  const outcome = outcomeBadge(position);
                  return (
                    <tr key={position.marketId} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`/market/${position.marketId}`} className="text-[0.8rem] text-[var(--text)] hover:text-[var(--red)]">
                          {position.marketQuestion}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-[3px] border px-2 py-[0.2rem] font-mono text-[0.5rem] uppercase tracking-[0.08em] ${sideBadgeClasses(position.side)}`}>
                          {position.side}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-[3px] border px-2 py-[0.2rem] font-mono text-[0.5rem] uppercase tracking-[0.08em] ${outcome.cls}`}>
                          {outcome.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[0.65rem] text-[var(--text-dim)]">{position.resolvedDate || '—'}</td>
                      <td className={`px-4 py-3 text-right font-mono text-[0.82rem] font-bold ${position.unrealizedPnl >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
                        {position.unrealizedPnl >= 0 ? '+' : '-'}{fmtMoney(Math.abs(position.unrealizedPnl)).slice(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isOwnProfile && user?.weeklyRank ? (
        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Current Weekly Rank</p>
          <p className="mt-1 font-mono text-[1.2rem] font-bold text-[var(--red)]">
            #{user.weeklyRank}
            <span className="ml-2 text-[0.7rem] font-normal text-[var(--text-dim)]">of {user.traderCount || 0} traders</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div>
      <p className="font-mono text-[0.48rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 font-mono text-[0.82rem] font-bold text-[var(--text)]">{value}</p>
    </div>
  );
}

function MetricCell({ label, value, tone }) {
  return (
    <div className="bg-[var(--surface)] px-4 py-4">
      <p className="font-mono text-[0.48rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1 font-mono text-[0.92rem] font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Metric({ label, value, tone = 'text-[var(--text)]' }) {
  return (
    <div>
      <p className="font-mono text-[0.48rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className={`font-mono text-[0.82rem] font-bold ${tone}`}>{value}</p>
    </div>
  );
}
