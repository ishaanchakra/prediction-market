'use client';

export default function MiniSparkline({ series, probability }) {
  const prob = typeof probability === 'number' ? probability : 0.5;
  const clamped = Math.max(0.02, Math.min(0.98, prob));

  const color = clamped > 0.65
    ? 'var(--green-bright)'
    : clamped < 0.35
      ? 'var(--red)'
      : 'var(--amber-bright)';

  const hasData = Array.isArray(series) && series.length >= 2;

  let points;
  if (hasData) {
    points = series.map((p, i) => {
      const x = (i / (series.length - 1)) * 100;
      const y = (1 - Math.max(0, Math.min(1, p))) * 36;
      return `${x},${y}`;
    });
  } else {
    const y = (1 - clamped) * 36;
    points = [`0,${y}`, `100,${y}`];
  }

  const pointsStr = points.join(' ');
  const lastPoint = points[points.length - 1];
  const [dotX, dotY] = lastPoint.split(',').map(Number);

  const gradientId = `sparkline-grad-${Math.round(clamped * 100)}`;

  return (
    <div className="mb-3 h-9">
      <svg
        width="100%"
        viewBox="0 0 100 36"
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline
          points={`${pointsStr} 100,36 0,36`}
          fill={`url(#${gradientId})`}
          stroke="none"
        />
        <polyline
          points={pointsStr}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={dotX}
          cy={dotY}
          r="2.5"
          fill={color}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
