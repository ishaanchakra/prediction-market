'use client';

export default function MutedTrendBackground({ series, probability }) {
  const prob = typeof probability === 'number'
    ? probability
    : (Array.isArray(series) && series.length > 0
        ? series[series.length - 1]
        : 0.5);

  const clamped = Math.max(0.02, Math.min(0.98, prob));

  const color = clamped > 0.65
    ? 'var(--green-bright)'
    : clamped < 0.35
      ? 'var(--red)'
      : 'var(--amber-bright)';

  return (
    <div
      className="pointer-events-none absolute bottom-0 left-0 right-0"
      style={{ height: '3px', background: 'var(--border)' }}
    >
      <div
        style={{
          height: '100%',
          width: `${Math.round(clamped * 100)}%`,
          background: color,
          opacity: 0.7,
          borderRadius: '0 2px 2px 0',
          transition: 'width 0.4s ease',
        }}
      />
    </div>
  );
}
