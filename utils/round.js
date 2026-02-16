export function round2(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}
