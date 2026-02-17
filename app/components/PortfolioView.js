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
    <div className="mb-3 flex items-center gap-2">
      <span className="inline-block h-px w-[18px] bg-[var(--red)]" />
      <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">{text}</span>
      {subtitle ? <span className="ml-auto font-display text-[0.85rem] italic text-[var(--text-dim)]">{subtitle}</span> : null}
    </div>
  );
}

function categoryBadge(category) {
  const map = {
    sports: { label: 'Sports', emoji: '🏒' },
    campus: { label: 'Campus Life', emoji: '🎓' },
    academic: { label: 'Academics', emoji: '📚' },
    admin: { label: 'Admin', emoji: '🏛️' },
    wildcard: { label: 'Wildcard', emoji: '🎲' }
  };
  return map[category] || map.wildcard;
}

function sideBadgeClasses(side) {
  if (side === 'YES') return 'text-[var(--green-bright)] bg-[rgba(34,197,94,0.08)] border-[rgba(34,197,94,0.15)]';
  if (side === 'NO') return 'text-[var(--red)] bg-[rgba(220,38,38,0.08)] border-[rgba(220,38,38,0.15)]';
  return 'text-[var(--text-dim)] bg-[var(--surface3)] border-[var(--border2)]';
}

function outcomeBadge(position) {
  if (position.marketStatus === MARKET_STATUS.CANCELLED) {
    return { label: 'Refund', cls: 'text-[var(--amber-bright)] bg-[rgba(245,158,11,0.1)] border-[rgba(245,158,11,0.15)]' };
  }

  const won =
    (position.marketResolution === 'YES' && position.yesShares >= position.noShares)
    || (position.marketResolution === 'NO' && position.noShares > position.yesShares);

  return won
    ? { label: 'Won', cls: 'text-[var(--green-bright)] bg-[rgba(34,197,94,0.1)] border-[rgba(34,197,94,0.15)]' }
    : { label: 'Lost', cls: 'text-[var(--red)] bg-[rgba(220,38,38,0.1)] border-[rgba(220,38,38,0.15)]' };
}

export default function PortfolioView({ user, bets }) {
  const positions = aggregatePositions(bets || []);
  const activePositions = positions
    .filter((pos) => [MARKET_STATUS.OPEN, MARKET_STATUS.LOCKED].includes(pos.marketStatus))
    .sort((a, b) => b.marketValue - a.marketValue);

  const closedPositions = positions
    .filter((pos) => [MARKET_STATUS.RESOLVED, MARKET_STATUS.CANCELLED].includes(pos.marketStatus))
    .sort((a, b) => b.marketValue - a.marketValue);

  const summary = calculatePortfolioSummary(user, activePositions);

  const total = Math.max(summary.portfolioValue, 1);
  const cashWidth = `${Math.max(0, Math.min(100, (summary.cashBalance / total) * 100))}%`;
  const yesWidth = `${Math.max(0, Math.min(100, (summary.yesExposure / total) * 100))}%`;
  const noWidth = `${Math.max(0, Math.min(100, (summary.noExposure / total) * 100))}%`;

  return (
    <div>
      {sectionLabel('Portfolio Overview', 'mark-to-market')}
      <div className="mb-6 grid grid-cols-2 gap-[1px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--border)] lg:grid-cols-4">
        <MetricCell
          label="Portfolio Value"
          value={fmtMoney(summary.portfolioValue)}
          sub="cash + positions"
          tone="text-[var(--amber-bright)]"
        />
        <MetricCell
          label="Weekly P&L"
          value={`${summary.weeklyPnl >= 0 ? '+' : '-'}${fmtMoney(Math.abs(summary.weeklyPnl)).slice(1)}`}
          sub="from $1,000 baseline"
          tone={summary.weeklyPnl >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}
        />
        <MetricCell
          label="Cash Available"
          value={fmtMoney(summary.cashBalance)}
          sub={`${round2(summary.cashPct)}% of portfolio`}
          tone="text-[var(--text-dim)]"
        />
        <MetricCell
          label="In Positions"
          value={fmtMoney(summary.positionsValue)}
          sub={`across ${summary.marketCount} markets`}
          tone="text-[var(--text-dim)]"
        />
      </div>

      <div className="mb-8 flex flex-col gap-3 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:flex-row sm:items-center sm:gap-2">
        <div className="flex h-[6px] flex-1 overflow-hidden rounded-[3px] bg-[var(--surface3)]">
          <div style={{ width: cashWidth, background: 'var(--amber-bright)' }} />
          <div style={{ width: yesWidth, background: 'var(--green-bright)' }} />
          <div style={{ width: noWidth, background: 'var(--red)' }} />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <LegendDot color="var(--amber-bright)" label={`Cash ${fmtMoney(summary.cashBalance)}`} />
          <LegendDot color="var(--green-bright)" label={`Yes ${fmtMoney(summary.yesExposure)}`} />
          <LegendDot color="var(--red)" label={`No ${fmtMoney(summary.noExposure)}`} />
        </div>
      </div>

      {sectionLabel('Active Positions', `${activePositions.length} markets`)}
      {activePositions.length === 0 ? (
        <div className="mb-10 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center font-mono text-[0.68rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
          No active positions
        </div>
      ) : (
        <div className="mb-10 flex flex-col gap-[6px]">
          {activePositions.map((position) => {
            const category = categoryBadge(position.marketCategory);
            const probPct = round2(position.marketProbability * 100);
            const fillColor = probPct > 65 ? 'var(--green-bright)' : probPct < 35 ? 'var(--red)' : 'var(--amber-bright)';
            const accent =
              position.side === 'YES'
                ? 'bg-[var(--green-bright)]'
                : position.side === 'NO'
                  ? 'bg-[var(--red)]'
                  : 'bg-gradient-to-b from-[var(--green-bright)] to-[var(--red)]';
            const sharesLabel =
              position.side === 'MIXED'
                ? `${round2(position.yesShares)}Y / ${round2(position.noShares)}N`
                : `${round2(position.side === 'NO' ? position.noShares : position.yesShares)}`;

            return (
              <Link
                key={position.marketId}
                href={`/market/${position.marketId}`}
                className="grid cursor-pointer grid-cols-[3px_1fr] overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-inherit transition-colors hover:border-[var(--border2)] hover:bg-[var(--surface2)]"
              >
                <div className={accent} />
                <div className="p-4 sm:px-5 sm:py-4">
                  <div className="mb-[0.6rem] flex items-start justify-between gap-3">
                    <span className="text-[0.88rem] font-semibold leading-[1.35] text-[var(--text)]">{position.marketQuestion}</span>
                    <span className="shrink-0 whitespace-nowrap rounded-[3px] border border-[var(--border2)] bg-[var(--surface3)] px-2 py-[0.2rem] font-mono text-[0.5rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      {category.emoji} {category.label}
                    </span>
                  </div>

                  <div className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[auto_auto_1fr_auto_auto]">
                    <div>
                      <span className={`inline-flex rounded-[3px] border px-[0.55rem] py-[0.2rem] font-mono text-[0.62rem] font-bold uppercase tracking-[0.06em] ${sideBadgeClasses(position.side)}`}>
                        {position.side}
                      </span>
                    </div>

                    <div className="flex flex-col gap-[0.15rem]">
                      <span className="font-mono text-[0.48rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Shares</span>
                      <span className="font-mono text-[0.82rem] font-bold text-[var(--text)]">{sharesLabel}</span>
                      <span className="font-mono text-[0.52rem] text-[var(--text-dim)]">cost {fmtMoney(position.totalCost)}</span>
                    </div>

                    <div className="hidden items-center gap-[0.4rem] sm:flex">
                      <div className="h-[4px] w-[48px] overflow-hidden rounded-[2px] bg-[var(--surface3)]">
                        <div className="h-full rounded-[2px]" style={{ width: `${probPct}%`, background: fillColor }} />
                      </div>
                      <span className="font-mono text-[0.72rem] font-bold text-[var(--text)]">{probPct}%</span>
                    </div>

                    <div className="flex flex-col gap-[0.15rem]">
                      <span className="font-mono text-[0.48rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Mkt Value</span>
                      <span className="font-mono text-[0.82rem] font-bold text-[var(--amber-bright)]">{fmtMoney(position.marketValue)}</span>
                    </div>

                    <div className="text-right">
                      <div className={`font-mono text-[0.92rem] font-bold ${position.unrealizedPnl >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
                        {position.unrealizedPnl >= 0 ? '+' : '-'}{fmtMoney(Math.abs(position.unrealizedPnl)).slice(1)}
                      </div>
                      <div className={`font-mono text-[0.52rem] ${position.unrealizedPnl >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
                        {position.unrealizedPnlPct >= 0 ? '+' : ''}{round2(position.unrealizedPnlPct)}%
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {sectionLabel('Closed Positions', `${closedPositions.length} markets`) }
      {closedPositions.length === 0 ? (
        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center font-mono text-[0.68rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
          No closed positions
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[8px] border border-[var(--border)]">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="bg-[var(--surface)] px-4 py-3 text-left font-mono text-[0.5rem] font-normal uppercase tracking-[0.1em] text-[var(--text-muted)]">Market</th>
                <th className="bg-[var(--surface)] px-4 py-3 text-left font-mono text-[0.5rem] font-normal uppercase tracking-[0.1em] text-[var(--text-muted)]">Side</th>
                <th className="bg-[var(--surface)] px-4 py-3 text-left font-mono text-[0.5rem] font-normal uppercase tracking-[0.1em] text-[var(--text-muted)]">Outcome</th>
                <th className="bg-[var(--surface)] px-4 py-3 text-left font-mono text-[0.5rem] font-normal uppercase tracking-[0.1em] text-[var(--text-muted)]">Resolved</th>
                <th className="bg-[var(--surface)] px-4 py-3 text-right font-mono text-[0.5rem] font-normal uppercase tracking-[0.1em] text-[var(--text-muted)]">P&L</th>
              </tr>
            </thead>
            <tbody>
              {closedPositions.map((position) => {
                const outcome = outcomeBadge(position);
                return (
                  <tr key={position.marketId} className="cursor-pointer transition-colors hover:[&>td]:bg-[var(--surface2)]">
                    <td className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                      <Link
                        href={`/market/${position.marketId}`}
                        className="block max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap text-[0.82rem] font-semibold text-[var(--text)]"
                      >
                        {position.marketQuestion}
                      </Link>
                    </td>
                    <td className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                      <span className={`inline-flex rounded-[3px] border px-2 py-[0.2rem] font-mono text-[0.52rem] font-bold uppercase tracking-[0.06em] ${sideBadgeClasses(position.side)}`}>
                        {position.side}
                      </span>
                    </td>
                    <td className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                      <span className={`inline-flex rounded-[3px] border px-2 py-[0.2rem] font-mono text-[0.52rem] font-bold uppercase tracking-[0.06em] ${outcome.cls}`}>
                        {outcome.label}
                      </span>
                    </td>
                    <td className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 font-mono text-[0.6rem] text-[var(--text-muted)]">
                      {position.resolvedDate || '—'}
                    </td>
                    <td className={`border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-right font-mono text-[0.82rem] font-bold ${position.unrealizedPnl >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
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
  );
}

function MetricCell({ label, value, sub, tone }) {
  return (
    <div className="bg-[var(--surface)] px-5 py-[1.1rem]">
      <p className="mb-[0.35rem] font-mono text-[0.52rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}</p>
      <p className={`font-mono text-[1.35rem] font-bold tracking-[-0.03em] ${tone}`}>{value}</p>
      <p className="mt-[0.25rem] font-mono text-[0.55rem] text-[var(--text-muted)]">{sub}</p>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-[0.35rem] font-mono text-[0.55rem] text-[var(--text-dim)]">
      <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
