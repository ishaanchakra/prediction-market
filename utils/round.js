export function round2(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

export function round6(num) {
  return Math.round((Number(num) + Number.EPSILON) * 1000000) / 1000000;
}

export function round8(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100000000) / 100000000;
}
