import { getPrice, calculateBet, calculateSell } from '../lmsr';

describe('getPrice', () => {
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
    const priceLowB = getPrice({ yes: 50, no: 0 }, 50);
    const priceHighB = getPrice({ yes: 50, no: 0 }, 200);
    // Higher b → price closer to 0.5
    expect(Math.abs(priceHighB - 0.5)).toBeLessThan(Math.abs(priceLowB - 0.5));
  });

  test('numerical stability with large values', () => {
    const price = getPrice({ yes: 10000, no: 0 }, 100);
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThanOrEqual(1);
    expect(isNaN(price)).toBe(false);
  });

  test('defaults missing shares to 0', () => {
    expect(getPrice({})).toBeCloseTo(0.5);
  });
});

describe('calculateBet', () => {
  test('YES bet increases probability', () => {
    const result = calculateBet({ yes: 0, no: 0 }, 50, 'YES');
    expect(result.newProbability).toBeGreaterThan(0.5);
  });

  test('NO bet decreases probability', () => {
    const result = calculateBet({ yes: 0, no: 0 }, 50, 'NO');
    expect(result.newProbability).toBeLessThan(0.5);
  });

  test('returns positive shares', () => {
    const result = calculateBet({ yes: 0, no: 0 }, 50, 'YES');
    expect(result.shares).toBeGreaterThan(0);
  });

  test('probability stays in [0, 1]', () => {
    const result = calculateBet({ yes: 0, no: 0 }, 1000, 'YES');
    expect(result.newProbability).toBeGreaterThanOrEqual(0);
    expect(result.newProbability).toBeLessThanOrEqual(1);
  });

  test('larger bet → more shares and more price movement', () => {
    const small = calculateBet({ yes: 0, no: 0 }, 10, 'YES');
    const large = calculateBet({ yes: 0, no: 0 }, 100, 'YES');
    expect(large.shares).toBeGreaterThan(small.shares);
    expect(large.newProbability).toBeGreaterThan(small.newProbability);
  });

  test('updates pool correctly', () => {
    const result = calculateBet({ yes: 0, no: 0 }, 50, 'YES');
    expect(result.newPool.yes).toBeGreaterThan(0);
    expect(result.newPool.no).toBe(0);

    const result2 = calculateBet({ yes: 0, no: 0 }, 50, 'NO');
    expect(result2.newPool.yes).toBe(0);
    expect(result2.newPool.no).toBeGreaterThan(0);
  });

  test('throws on NaN result', () => {
    expect(() => calculateBet({ yes: NaN, no: 0 }, 50, 'YES')).toThrow('NaN');
  });
});

describe('calculateSell', () => {
  test('selling YES decreases probability', () => {
    const pool = { yes: 50, no: 0 };
    const result = calculateSell(pool, 25, 'YES');
    expect(result.newProbability).toBeLessThan(getPrice(pool));
  });

  test('selling NO increases probability', () => {
    const pool = { yes: 0, no: 50 };
    const result = calculateSell(pool, 25, 'NO');
    expect(result.newProbability).toBeGreaterThan(getPrice(pool));
  });

  test('payout is positive', () => {
    const result = calculateSell({ yes: 100, no: 0 }, 50, 'YES');
    expect(result.payout).toBeGreaterThan(0);
  });

  test('buy-then-sell round-trips approximately', () => {
    const initial = { yes: 0, no: 0 };
    const betAmount = 50;
    const buyResult = calculateBet(initial, betAmount, 'YES');
    const sellResult = calculateSell(buyResult.newPool, buyResult.shares, 'YES');
    // Payout should be approximately the original bet amount
    expect(sellResult.payout).toBeCloseTo(betAmount, 0);
  });

  test('throws on NaN result', () => {
    expect(() => calculateSell({ yes: NaN, no: 0 }, 50, 'YES')).toThrow('NaN');
  });
});
