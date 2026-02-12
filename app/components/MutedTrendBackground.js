'use client';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildPath(series) {
  const values = Array.isArray(series) && series.length > 0
    ? series.map((value) => clamp(value, 0.02, 0.98))
    : [0.5, 0.5];
  const points = [];
  const denominator = Math.max(values.length - 1, 1);

  for (let i = 0; i < values.length; i += 1) {
    const x = (i / denominator) * 100;
    // Constrain sparkline to lower band so peaks never collide with titles.
    const y = (1 - values[i]) * 35 + 52;
    points.push({ x, y });
  }

  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
  }

  // Catmull-Rom to Bezier with reduced tension: smoother but still slightly pointed.
  const tensionDivisor = 10;
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / tensionDivisor;
    const cp1y = p1.y + (p2.y - p0.y) / tensionDivisor;
    const cp2x = p2.x - (p3.x - p1.x) / tensionDivisor;
    const cp2y = p2.y - (p3.y - p1.y) / tensionDivisor;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return d;
}

export default function MutedTrendBackground({ series }) {
  return (
    <div className="pointer-events-none absolute inset-0 opacity-20">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <path
          d={buildPath(series)}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="text-brand-red"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
