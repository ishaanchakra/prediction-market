import { getPrice, calculateBet, calculateSell } from '../lmsr';

function cost(qYes, qNo, b = 100) {
  const max = Math.max(qYes, qNo);
  return b * (max / b + Math.log(Math.exp((qYes - max) / b) + Math.exp((qNo - max) / b)));
}

describe('getPrice', () => {
  test('symmetry — equal shares returns exactly 0.5', () => {
    expect(getPrice({ yes: 0, no: 0 })).toBeCloseTo(0.5, 12);
    expect(getPrice({ yes: 100, no: 100 })).toBeCloseTo(0.5, 12);
    expect(getPrice({ yes: 1000, no: 1000 })).toBeCloseTo(0.5, 12);
  });

  test('monotonicity — more YES shares → higher price', () => {
    expect(getPrice({ yes: 50, no: 0 })).toBeGreaterThan(0.5);
    expect(getPrice({ yes: 0, no: 50 })).toBeLessThan(0.5);
    expect(getPrice({ yes: 200, no: 100 })).toBeGreaterThan(getPrice({ yes: 100, no: 100 }));
  });

  test('probability bounds — always in (0, 1) exclusive', () => {
    [0, 1, 10, 100, 1000, 10000].forEach((qYes) => {
      const p = getPrice({ yes: qYes, no: 0 });
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
      expect(Number.isNaN(p)).toBe(false);
    });
  });

  test('numerical stability — extreme values do not produce NaN', () => {
    const highYes = getPrice({ yes: 100000, no: 0 });
    const highNo = getPrice({ yes: 0, no: 100000 });
    const equal = getPrice({ yes: 100000, no: 100000 });
    expect(Number.isFinite(highYes)).toBe(true);
    expect(Number.isFinite(highNo)).toBe(true);
    expect(highYes).toBeGreaterThan(0.999999);
    expect(highNo).toBeLessThan(0.000001);
    expect(equal).toBeCloseTo(0.5, 12);
  });

  test('complement — getPrice(yes,no) + getPrice(no,yes) = 1', () => {
    const pairs = [
      [0, 0],
      [5, 1],
      [12, 90],
      [500, 250],
      [2500, 123]
    ];
    pairs.forEach(([yes, no]) => {
      expect(getPrice({ yes, no }) + getPrice({ yes: no, no: yes })).toBeCloseTo(1, 12);
    });
  });

  test('b sensitivity — higher b gives price closer to 0.5', () => {
    const lowB = getPrice({ yes: 50, no: 0 }, 50);
    const highB = getPrice({ yes: 50, no: 0 }, 200);
    expect(Math.abs(highB - 0.5)).toBeLessThan(Math.abs(lowB - 0.5));
  });

  test('missing fields default to 0', () => {
    expect(getPrice({})).toBeCloseTo(0.5, 12);
    expect(getPrice({ yes: 50 })).toBeCloseTo(getPrice({ yes: 50, no: 0 }), 12);
  });

  test('throws on non-finite input', () => {
    expect(() => getPrice({ yes: Number.NaN, no: 0 })).toThrow();
    expect(() => getPrice({ yes: Number.POSITIVE_INFINITY, no: 0 })).toThrow();
    expect(() => getPrice({ yes: 0, no: Number.NEGATIVE_INFINITY })).toThrow();
  });
});

describe('calculateBet', () => {
  test('YES bet increases probability', () => {
    expect(calculateBet({ yes: 0, no: 0 }, 50, 'YES').newProbability).toBeGreaterThan(0.5);
  });

  test('NO bet decreases probability', () => {
    expect(calculateBet({ yes: 0, no: 0 }, 50, 'NO').newProbability).toBeLessThan(0.5);
  });

  test('shares are positive', () => {
    expect(calculateBet({ yes: 0, no: 0 }, 50, 'YES').shares).toBeGreaterThan(0);
  });

  test('pool updated correctly', () => {
    const result = calculateBet({ yes: 0, no: 0 }, 50, 'YES');
    expect(result.newPool.yes).toBeGreaterThan(0);
    expect(result.newPool.no).toBe(0);

    const result2 = calculateBet({ yes: 0, no: 0 }, 50, 'NO');
    expect(result2.newPool.yes).toBe(0);
    expect(result2.newPool.no).toBeGreaterThan(0);
  });

  test('probability in [0,1]', () => {
    expect(calculateBet({ yes: 0, no: 0 }, 10000, 'YES').newProbability).toBeLessThanOrEqual(1);
    expect(calculateBet({ yes: 0, no: 0 }, 10000, 'NO').newProbability).toBeGreaterThanOrEqual(0);
  });

  test('monotonicity — larger bet means more shares and larger move', () => {
    const small = calculateBet({ yes: 0, no: 0 }, 10, 'YES');
    const large = calculateBet({ yes: 0, no: 0 }, 100, 'YES');
    expect(large.shares).toBeGreaterThan(small.shares);
    expect(large.newProbability).toBeGreaterThan(small.newProbability);
  });

  test('cost consistency — cost of shares equals bet amount', () => {
    const result = calculateBet({ yes: 0, no: 0 }, 50, 'YES', 100);
    const costPaid = cost(result.newPool.yes, 0, 100) - cost(0, 0, 100);
    expect(Math.abs(costPaid - 50)).toBeLessThan(0.01);
  });

  test('already-skewed market — bet on dominant side', () => {
    const pool = calculateBet({ yes: 0, no: 0 }, 200, 'YES').newPool;
    const result = calculateBet(pool, 50, 'YES');
    expect(result.newProbability).toBeGreaterThan(getPrice(pool));
    expect(result.shares).toBeGreaterThan(0);
  });

  test('bet on trailing side of skewed market', () => {
    const pool = calculateBet({ yes: 0, no: 0 }, 200, 'YES').newPool;
    const result = calculateBet(pool, 50, 'NO');
    expect(result.newProbability).toBeLessThan(getPrice(pool));
  });

  test('very small bet ($0.01) does not crash', () => {
    const result = calculateBet({ yes: 0, no: 0 }, 0.01, 'YES');
    expect(result.shares).toBeGreaterThan(0);
    expect(Number.isFinite(result.newProbability)).toBe(true);
  });

  test('large b value → smaller price impact', () => {
    const highB = calculateBet({ yes: 0, no: 0 }, 100, 'YES', 1000);
    const lowB = calculateBet({ yes: 0, no: 0 }, 100, 'YES', 10);
    expect(Math.abs(highB.newProbability - 0.5)).toBeLessThan(Math.abs(lowB.newProbability - 0.5));
  });

  test('throws on invalid inputs', () => {
    expect(() => calculateBet({ yes: Number.NaN, no: 0 }, 50, 'YES')).toThrow();
    expect(() => calculateBet({ yes: 0, no: 0 }, 0, 'YES')).toThrow('positive');
    expect(() => calculateBet({ yes: 0, no: 0 }, -10, 'YES')).toThrow();
    expect(() => calculateBet({ yes: 0, no: 0 }, 50, 'YES', 0)).toThrow('b must be positive');
    expect(() => calculateBet({ yes: 0, no: 0 }, 50, 'YES', -1)).toThrow('b must be positive');
  });
});

describe('calculateSell', () => {
  test('selling YES shares decreases probability', () => {
    const buyResult = calculateBet({ yes: 0, no: 0 }, 100, 'YES');
    const sellResult = calculateSell(buyResult.newPool, buyResult.shares / 2, 'YES');
    expect(sellResult.newProbability).toBeLessThan(getPrice(buyResult.newPool));
  });

  test('selling NO shares increases probability', () => {
    const buyResult = calculateBet({ yes: 0, no: 0 }, 100, 'NO');
    const sellResult = calculateSell(buyResult.newPool, buyResult.shares / 2, 'NO');
    expect(sellResult.newProbability).toBeGreaterThan(getPrice(buyResult.newPool));
  });

  test('payout is positive', () => {
    const buyResult = calculateBet({ yes: 0, no: 0 }, 50, 'YES');
    const sellResult = calculateSell(buyResult.newPool, buyResult.shares, 'YES');
    expect(sellResult.payout).toBeGreaterThan(0);
  });

  test('round-trip — buy then sell all shares ≈ original amount', () => {
    const betAmount = 50;
    const buy = calculateBet({ yes: 0, no: 0 }, betAmount, 'YES');
    const sell = calculateSell(buy.newPool, buy.shares, 'YES');
    expect(Math.abs(sell.payout - betAmount)).toBeLessThan(0.05);
  });

  test('round-trip on NO side', () => {
    const betAmount = 75;
    const buy = calculateBet({ yes: 0, no: 0 }, betAmount, 'NO');
    const sell = calculateSell(buy.newPool, buy.shares, 'NO');
    expect(Math.abs(sell.payout - betAmount)).toBeLessThan(0.05);
  });

  test('round-trip on skewed market', () => {
    const pool = calculateBet({ yes: 0, no: 0 }, 200, 'YES').newPool;
    const betAmount = 30;
    const buy = calculateBet(pool, betAmount, 'YES');
    const sell = calculateSell(buy.newPool, buy.shares, 'YES');
    expect(Math.abs(sell.payout - betAmount)).toBeLessThan(0.05);
  });

  test('partial sell payout is less than full sell payout', () => {
    const buy = calculateBet({ yes: 0, no: 0 }, 100, 'YES');
    const fullSell = calculateSell(buy.newPool, buy.shares, 'YES');
    const halfSell = calculateSell(buy.newPool, buy.shares / 2, 'YES');
    expect(halfSell.payout).toBeLessThan(fullSell.payout);
    expect(halfSell.payout).toBeGreaterThan(0);
  });

  test('pool correctly updated after full sell', () => {
    const buy = calculateBet({ yes: 0, no: 0 }, 100, 'YES');
    const sell = calculateSell(buy.newPool, buy.shares, 'YES');
    expect(Math.abs(sell.newPool.yes)).toBeLessThan(0.01);
  });

  test('selling 0 shares throws', () => {
    expect(() => calculateSell({ yes: 50, no: 0 }, 0, 'YES')).toThrow('positive');
  });

  test('selling negative shares throws', () => {
    expect(() => calculateSell({ yes: 50, no: 0 }, -5, 'YES')).toThrow('positive');
  });

  test('NaN pool throws', () => {
    expect(() => calculateSell({ yes: Number.NaN, no: 0 }, 10, 'YES')).toThrow();
  });

  test('selling more shares than exist throws explicitly', () => {
    expect(() => calculateSell({ yes: 10, no: 0 }, 1000, 'YES')).toThrow();
  });
});

describe('Sequential Multi-Trade Consistency', () => {
  test('path independence of end price', () => {
    const r1 = calculateBet({ yes: 0, no: 0 }, 25, 'YES');
    const r2 = calculateBet(r1.newPool, 25, 'YES');
    const r3 = calculateBet({ yes: 0, no: 0 }, 50, 'YES');
    expect(Math.abs(r2.newProbability - r3.newProbability)).toBeLessThan(0.001);
  });

  test('alternating buy/sell leaves market near initial state', () => {
    const buy1 = calculateBet({ yes: 0, no: 0 }, 100, 'YES');
    const sell1 = calculateSell(buy1.newPool, buy1.shares, 'YES');
    const buy2 = calculateBet(sell1.newPool, 100, 'NO');
    const sell2 = calculateSell(buy2.newPool, buy2.shares, 'NO');
    expect(Math.abs(getPrice(sell2.newPool) - 0.5)).toBeLessThan(0.01);
  });

  test('10 sequential small bets same side = one large bet probability', () => {
    let pool = { yes: 0, no: 0 };
    for (let i = 0; i < 10; i += 1) {
      pool = calculateBet(pool, 10, 'YES').newPool;
    }
    const finalProbSmall = getPrice(pool);
    const bigResult = calculateBet({ yes: 0, no: 0 }, 100, 'YES');
    const finalProbBig = bigResult.newProbability;
    expect(Math.abs(finalProbSmall - finalProbBig)).toBeLessThan(0.001);
  });
});
