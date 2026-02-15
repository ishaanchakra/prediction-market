import { calculateRefundsByUser, round2 } from '../refunds';

// ─── round2 ──────────────────────────────────────────────────────────────────

describe('round2', () => {
  test('rounds to 2 decimal places', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(1.004)).toBe(1.00);
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.235)).toBe(1.24);
  });

  test('integers pass through unchanged', () => {
    expect(round2(100)).toBe(100);
    expect(round2(0)).toBe(0);
  });

  test('negative values round correctly', () => {
    expect(round2(-1.005)).toBe(-1.00);
    expect(round2(-1.234)).toBe(-1.23);
  });

  test('very small values', () => {
    expect(round2(0.001)).toBe(0);
    expect(round2(0.005)).toBe(0.01);
  });

  test('NaN input returns NaN', () => {
    expect(isNaN(round2(NaN))).toBe(true);
  });
});

// ─── calculateRefundsByUser ──────────────────────────────────────────────────

describe('calculateRefundsByUser', () => {
  // --- existing coverage ---
  test('refunds full buy-only amounts', () => {
    expect(calculateRefundsByUser([
      { userId: 'u1', amount: 40 },
      { userId: 'u2', amount: 20 },
    ])).toEqual({ u1: 40, u2: 20 });
  });

  test('handles partial exits with buy and sell', () => {
    expect(calculateRefundsByUser([
      { userId: 'u1', amount: 100 },
      { userId: 'u1', amount: -35 },
      { userId: 'u1', amount: 10 },
    ])).toEqual({ u1: 75 });
  });

  test('does not refund fully exited positions', () => {
    expect(calculateRefundsByUser([
      { userId: 'u1', amount: 30 },
      { userId: 'u1', amount: -30 },
    ])).toEqual({});
  });

  test('supports multiple users and ignores negative net', () => {
    expect(calculateRefundsByUser([
      { userId: 'u1', amount: 50 },
      { userId: 'u1', amount: -10 },
      { userId: 'u2', amount: 25 },
      { userId: 'u2', amount: -30 },
      { userId: 'u3', amount: 15 },
    ])).toEqual({ u1: 40, u3: 15 });
  });

  // --- new edge cases ---

  test('empty array → no refunds', () => {
    expect(calculateRefundsByUser([])).toEqual({});
  });

  test('single bet with amount=0 → no refund (no net exposure)', () => {
    expect(calculateRefundsByUser([
      { userId: 'u1', amount: 0 },
    ])).toEqual({});
  });

  test('bet with missing userId is silently skipped', () => {
    expect(calculateRefundsByUser([
      { amount: 50 },              // no userId
      { userId: '', amount: 50 },  // empty string userId
      { userId: 'u1', amount: 20 },
    ])).toEqual({ u1: 20 });
  });

  test('bet with null/undefined in array is skipped without throwing', () => {
    expect(() => calculateRefundsByUser([
      null,
      undefined,
      { userId: 'u1', amount: 30 },
    ])).not.toThrow();

    expect(calculateRefundsByUser([
      null,
      undefined,
      { userId: 'u1', amount: 30 },
    ])).toEqual({ u1: 30 });
  });

  test('amount as string is coerced via Number()', () => {
    // The implementation does Number(bet.amount || 0)
    expect(calculateRefundsByUser([
      { userId: 'u1', amount: '50' },
      { userId: 'u1', amount: '-20' },
    ])).toEqual({ u1: 30 });
  });

  test('floating point amounts are rounded correctly', () => {
    // 33.33 + 33.33 + 33.34 = 100.00 — no float drift in result
    const result = calculateRefundsByUser([
      { userId: 'u1', amount: 33.33 },
      { userId: 'u1', amount: 33.33 },
      { userId: 'u1', amount: 33.34 },
    ]);
    expect(result.u1).toBeCloseTo(100, 2);
  });

  test('very large amounts are handled correctly', () => {
    expect(calculateRefundsByUser([
      { userId: 'u1', amount: 999999.99 },
    ])).toEqual({ u1: 999999.99 });
  });

  test('user with only sells (negative net) receives no refund', () => {
    expect(calculateRefundsByUser([
      { userId: 'u1', amount: -50 },
      { userId: 'u1', amount: -20 },
    ])).toEqual({});
  });

  test('net exactly zero → no refund', () => {
    expect(calculateRefundsByUser([
      { userId: 'u1', amount: 75 },
      { userId: 'u1', amount: -75 },
    ])).toEqual({});
  });

  test('many small bets accumulate correctly without precision loss', () => {
    const bets = Array.from({ length: 100 }, () => ({ userId: 'u1', amount: 0.1 }));
    const result = calculateRefundsByUser(bets);
    expect(result.u1).toBeCloseTo(10, 1);
  });

  test('interleaved buys and sells across multiple users', () => {
    const result = calculateRefundsByUser([
      { userId: 'u1', amount: 100 },
      { userId: 'u2', amount: 50 },
      { userId: 'u1', amount: -40 },
      { userId: 'u3', amount: 25 },
      { userId: 'u2', amount: -50 }, // u2 fully exited
      { userId: 'u3', amount: 10 },
    ]);
    expect(result).toEqual({ u1: 60, u3: 35 });
    expect(result.u2).toBeUndefined();
  });

  test('single user with $0.01 net gets refunded $0.01', () => {
    expect(calculateRefundsByUser([
      { userId: 'u1', amount: 50 },
      { userId: 'u1', amount: -49.99 },
    ])).toEqual({ u1: 0.01 });
  });
});