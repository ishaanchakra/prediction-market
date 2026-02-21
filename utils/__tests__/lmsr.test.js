import { getPrice, calculateBet, calculateSell } from '../lmsr';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Seed a market to a given probability using the logit formula */
function seededPool(prob, b = 100) {
  return { yes: b * Math.log(prob / (1 - prob)), no: 0 };
}

// ─── getPrice ────────────────────────────────────────────────────────────────

describe('getPrice', () => {
  // --- existing coverage (kept for regression) ---
  test('equal shares returns 0.5', () => {
    expect(getPrice({ yes: 0, no: 0 })).toBeCloseTo(0.5);
    expect(getPrice({ yes: 100, no: 100 })).toBeCloseTo(0.5);
  });

  test('more YES shares → higher price', () => {
    expect(getPrice({ yes: 50, no: 0 })).toBeGreaterThan(0.5);
  });

  test('more NO shares → lower price', () => {
    expect(getPrice({ yes: 0, no: 50 })).toBeLessThan(0.5);
  });

  test('higher b reduces price impact', () => {
    const priceLowB  = getPrice({ yes: 50, no: 0 }, 50);
    const priceHighB = getPrice({ yes: 50, no: 0 }, 200);
    expect(Math.abs(priceHighB - 0.5)).toBeLessThan(Math.abs(priceLowB - 0.5));
  });

  test('numerical stability with large values', () => {
    const p = getPrice({ yes: 10000, no: 0 }, 100);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(1);
    expect(isNaN(p)).toBe(false);
  });

  test('defaults missing shares to 0', () => {
    expect(getPrice({})).toBeCloseTo(0.5);
  });

  // --- new edge cases ---
  test('seeded 70% pool returns ~70%', () => {
    expect(getPrice(seededPool(0.7))).toBeCloseTo(0.7, 4);
  });

  test('seeded 95% pool returns ~95%', () => {
    expect(getPrice(seededPool(0.95))).toBeCloseTo(0.95, 4);
  });

  test('seeded 5% pool returns ~5%', () => {
    expect(getPrice(seededPool(0.05))).toBeCloseTo(0.05, 4);
  });

  test('symmetry: YES and NO pools at same magnitude mirror each other', () => {
    const pYes = getPrice({ yes: 200, no: 0 });
    const pNo  = getPrice({ yes: 0, no: 200 });
    expect(pYes + pNo).toBeCloseTo(1, 10);
    expect(pYes).toBeCloseTo(1 - pNo, 10);
  });

  test('very large b → price barely moves from 0.5 with same shares', () => {
    const p = getPrice({ yes: 50, no: 0 }, 10000);
    expect(p).toBeCloseTo(0.5, 1); // within 0.05 of 0.5
  });

  test('very small b → price moves sharply', () => {
    const p = getPrice({ yes: 5, no: 0 }, 1);
    expect(p).toBeGreaterThan(0.99);
  });

  test('negative qNo (should not arise in practice, but handles gracefully)', () => {
    // negative qNo means NO side has been sold back – result should still be valid
    const p = getPrice({ yes: 100, no: -10 }, 100);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(1);
    expect(isNaN(p)).toBe(false);
  });
});

// ─── calculateBet ────────────────────────────────────────────────────────────

describe('calculateBet', () => {
  // --- existing coverage ---
  test('YES bet increases probability', () => {
    expect(calculateBet({ yes: 0, no: 0 }, 50, 'YES').newProbability).toBeGreaterThan(0.5);
  });

  test('NO bet decreases probability', () => {
    expect(calculateBet({ yes: 0, no: 0 }, 50, 'NO').newProbability).toBeLessThan(0.5);
  });

  test('returns positive shares', () => {
    expect(calculateBet({ yes: 0, no: 0 }, 50, 'YES').shares).toBeGreaterThan(0);
  });

  test('probability stays in [0, 1]', () => {
    const r = calculateBet({ yes: 0, no: 0 }, 1000, 'YES');
    expect(r.newProbability).toBeGreaterThanOrEqual(0);
    expect(r.newProbability).toBeLessThanOrEqual(1);
  });

  test('larger bet → more shares and more price movement', () => {
    const small = calculateBet({ yes: 0, no: 0 }, 10,  'YES');
    const large = calculateBet({ yes: 0, no: 0 }, 100, 'YES');
    expect(large.shares).toBeGreaterThan(small.shares);
    expect(large.newProbability).toBeGreaterThan(small.newProbability);
  });

  test('updates pool correctly', () => {
    const r1 = calculateBet({ yes: 0, no: 0 }, 50, 'YES');
    expect(r1.newPool.yes).toBeGreaterThan(0);
    expect(r1.newPool.no).toBe(0);

    const r2 = calculateBet({ yes: 0, no: 0 }, 50, 'NO');
    expect(r2.newPool.yes).toBe(0);
    expect(r2.newPool.no).toBeGreaterThan(0);
  });

  test('throws on non-finite pool input', () => {
    expect(() => calculateBet({ yes: NaN, no: 0 }, 50, 'YES')).toThrow('finite');
  });

  // --- new edge cases ---

  test('tiny bet ($0.01) returns non-zero shares', () => {
    const r = calculateBet({ yes: 0, no: 0 }, 0.01, 'YES');
    expect(r.shares).toBeGreaterThan(0);
    expect(isNaN(r.shares)).toBe(false);
    expect(r.newProbability).toBeGreaterThan(0.5);
  });

  test('large bet ($100,000) does not produce NaN or Infinity', () => {
    const r = calculateBet({ yes: 0, no: 0 }, 100000, 'YES');
    expect(isNaN(r.shares)).toBe(false);
    expect(isFinite(r.shares)).toBe(true);
    expect(r.newProbability).toBeLessThanOrEqual(1);
    expect(r.newProbability).toBeGreaterThan(0.5);
  });

  test('YES bet on extreme-probability market (95%) gives valid result', () => {
    // This tests the binary search ceiling fix: hi = betAmount * 10 was too small here
    const pool = seededPool(0.95); // qYes ≈ 294
    const r = calculateBet(pool, 50, 'YES');
    expect(r.shares).toBeGreaterThan(0);
    expect(isNaN(r.shares)).toBe(false);
    expect(r.newProbability).toBeGreaterThan(0.95);
    expect(r.newProbability).toBeLessThanOrEqual(1);
  });

  test('does not throw on $2000 YES bet against a seeded 95% pool with b=100', () => {
    const pool = seededPool(0.95, 100);
    expect(() => calculateBet(pool, 2000, 'YES', 100)).not.toThrow();
  });

  test('NO bet on 5% market gives valid result', () => {
    const pool = seededPool(0.05);
    const r = calculateBet(pool, 50, 'NO');
    expect(r.shares).toBeGreaterThan(0);
    expect(r.newProbability).toBeLessThan(0.05);
    expect(r.newProbability).toBeGreaterThanOrEqual(0);
  });

  test('pool conservation: YES bet increments qYes by exactly shares received', () => {
    const pool = { yes: 0, no: 0 };
    const r = calculateBet(pool, 100, 'YES');
    expect(r.newPool.yes).toBeCloseTo(pool.yes + r.shares, 5);
    expect(r.newPool.no).toBe(pool.no);
  });

  test('pool conservation: NO bet increments qNo by exactly shares received', () => {
    const pool = { yes: 50, no: 20 };
    const r = calculateBet(pool, 100, 'NO');
    expect(r.newPool.no).toBeCloseTo(pool.no + r.shares, 5);
    expect(r.newPool.yes).toBe(pool.yes);
  });

  test('YES and NO bets from 50% are symmetric', () => {
    const rYes = calculateBet({ yes: 0, no: 0 }, 50, 'YES');
    const rNo  = calculateBet({ yes: 0, no: 0 }, 50, 'NO');
    expect(rYes.shares).toBeCloseTo(rNo.shares, 5);
    expect(rYes.newProbability + rNo.newProbability).toBeCloseTo(1, 5);
  });

  test('small b (b=10) → larger price impact per dollar', () => {
    const rSmall = calculateBet({ yes: 0, no: 0 }, 50, 'YES', 10);
    const rLarge = calculateBet({ yes: 0, no: 0 }, 50, 'YES', 500);
    expect(rSmall.newProbability).toBeGreaterThan(rLarge.newProbability);
  });

  test('large b (b=1000) → very small price impact', () => {
    const r = calculateBet({ yes: 0, no: 0 }, 50, 'YES', 1000);
    expect(r.newProbability).toBeCloseTo(0.5, 1);
    expect(r.newProbability).toBeGreaterThan(0.5);
  });

  test('seeded 70% market: YES bet pushes above 70%', () => {
    const r = calculateBet(seededPool(0.7), 50, 'YES');
    expect(r.newProbability).toBeGreaterThan(0.7);
  });

  test('seeded 70% market: NO bet pushes below 70%', () => {
    const r = calculateBet(seededPool(0.7), 50, 'NO');
    expect(r.newProbability).toBeLessThan(0.7);
  });

  test('sequential bets move price monotonically', () => {
    let pool = { yes: 0, no: 0 };
    const probs = [];
    for (let i = 0; i < 5; i++) {
      const r = calculateBet(pool, 20, 'YES');
      probs.push(r.newProbability);
      pool = r.newPool;
    }
    for (let i = 1; i < probs.length; i++) {
      expect(probs[i]).toBeGreaterThan(probs[i - 1]);
    }
  });

  test('buy YES then buy NO brings price back toward start', () => {
    const start = getPrice({ yes: 0, no: 0 });
    const r1 = calculateBet({ yes: 0, no: 0 }, 50, 'YES');
    const r2 = calculateBet(r1.newPool, 50, 'NO');
    // Price should be closer to start after NO bet
    expect(Math.abs(r2.newProbability - start))
      .toBeLessThan(Math.abs(r1.newProbability - start));
  });
});

// ─── calculateSell ───────────────────────────────────────────────────────────

describe('calculateSell', () => {
  // --- existing coverage ---
  test('selling YES decreases probability', () => {
    const pool = { yes: 50, no: 0 };
    expect(calculateSell(pool, 25, 'YES').newProbability)
      .toBeLessThan(getPrice(pool));
  });

  test('selling NO increases probability', () => {
    const pool = { yes: 0, no: 50 };
    expect(calculateSell(pool, 25, 'NO').newProbability)
      .toBeGreaterThan(getPrice(pool));
  });

  test('payout is positive', () => {
    expect(calculateSell({ yes: 100, no: 0 }, 50, 'YES').payout)
      .toBeGreaterThan(0);
  });

  test('buy-then-sell round-trip (50% market)', () => {
    const betAmount = 50;
    const buy  = calculateBet({ yes: 0, no: 0 }, betAmount, 'YES');
    const sell = calculateSell(buy.newPool, buy.shares, 'YES');
    expect(sell.payout).toBeCloseTo(betAmount, 0);
  });

  test('throws on non-finite pool input', () => {
    expect(() => calculateSell({ yes: NaN, no: 0 }, 50, 'YES')).toThrow('finite');
  });

  // --- new edge cases ---

  test('sell 0 shares returns 0 payout without error', () => {
    const pool = { yes: 100, no: 0 };
    const r = calculateSell(pool, 0, 'YES');
    expect(r.payout).toBe(0);
  });

  test('buy-then-sell round-trip on seeded 70% market', () => {
    const pool = seededPool(0.7);
    const betAmount = 80;
    const buy  = calculateBet(pool, betAmount, 'YES');
    const sell = calculateSell(buy.newPool, buy.shares, 'YES');
    expect(sell.payout).toBeCloseTo(betAmount, 0);
    // Price should return to starting probability
    expect(sell.newProbability).toBeCloseTo(0.7, 3);
  });

  test('buy-then-sell round-trip on seeded 95% market', () => {
    const pool = seededPool(0.95);
    const betAmount = 30;
    const buy  = calculateBet(pool, betAmount, 'NO');
    const sell = calculateSell(buy.newPool, buy.shares, 'NO');
    expect(sell.payout).toBeCloseTo(betAmount, 0);
  });

  test('sell after price moved in your favor yields more than invested', () => {
    // u1 buys YES, then u2 also buys YES (drives price up), then u1 sells
    const pool0 = { yes: 0, no: 0 };
    const u1buy = calculateBet(pool0, 50, 'YES');
    const u2buy = calculateBet(u1buy.newPool, 200, 'YES'); // big bet pushes price up
    const u1sell = calculateSell(u2buy.newPool, u1buy.shares, 'YES');
    expect(u1sell.payout).toBeGreaterThan(50); // sold into higher price
  });

  test('sell after price moved against you yields less than invested', () => {
    // u1 buys YES, then u2 buys NO heavily (drives price down), u1 sells
    const pool0 = { yes: 0, no: 0 };
    const u1buy = calculateBet(pool0, 50, 'YES');
    const u2buy = calculateBet(u1buy.newPool, 300, 'NO');
    const u1sell = calculateSell(u2buy.newPool, u1buy.shares, 'YES');
    expect(u1sell.payout).toBeLessThan(50);
    expect(u1sell.payout).toBeGreaterThanOrEqual(0); // never negative
  });

  test('selling more YES shares than pool qYes clamps to pool and returns valid payout', () => {
    const pool = { yes: 50, no: 0 };
    expect(() => calculateSell(pool, 80, 'YES')).not.toThrow();
    const r = calculateSell(pool, 80, 'YES');
    expect(r.payout).toBeGreaterThanOrEqual(0);
    expect(isNaN(r.payout)).toBe(false);
  });

  test('selling more NO shares than pool qNo clamps to pool and returns valid payout', () => {
    const pool = { yes: 0, no: 30 };
    expect(() => calculateSell(pool, 50, 'NO')).not.toThrow();
    const r = calculateSell(pool, 50, 'NO');
    expect(r.payout).toBeGreaterThanOrEqual(0);
    expect(isNaN(r.payout)).toBe(false);
  });

  test('clamped sell on seeded 95% pool does not crash', () => {
    const pool = { yes: 294, no: 0 };
    expect(() => calculateSell(pool, 50, 'NO')).not.toThrow();
  });

  test('tiny sell (0.001 shares) returns non-zero positive payout', () => {
    const pool = { yes: 200, no: 0 };
    const r = calculateSell(pool, 0.001, 'YES');
    expect(r.payout).toBeGreaterThan(0);
    expect(isNaN(r.payout)).toBe(false);
  });

  test('pool is updated correctly after sell', () => {
    const pool = { yes: 100, no: 40 };
    const r = calculateSell(pool, 30, 'YES');
    expect(r.newPool.yes).toBeCloseTo(100 - 30, 5);
    expect(r.newPool.no).toBe(40);
  });

  test('selling all YES shares from symmetric pool returns ~half the cost', () => {
    // Buy YES from 50%, sell all shares back
    const buy  = calculateBet({ yes: 0, no: 0 }, 100, 'YES');
    const sell = calculateSell(buy.newPool, buy.shares, 'YES');
    // Payout should equal original bet (LMSR property)
    expect(sell.payout).toBeCloseTo(100, 0);
  });

  test('result probability is always in [0, 1]', () => {
    const cases = [
      [{ yes: 500, no: 0 }, 400, 'YES'],
      [{ yes: 0, no: 500 }, 400, 'NO'],
      [{ yes: 100, no: 100 }, 50, 'YES'],
    ];
    for (const [pool, shares, side] of cases) {
      const r = calculateSell(pool, shares, side);
      expect(r.newProbability).toBeGreaterThanOrEqual(0);
      expect(r.newProbability).toBeLessThanOrEqual(1);
    }
  });
});
