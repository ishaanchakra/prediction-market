import { calculateMarketContribution, calculateUserOracleScore } from '../oracleScore';

// ─── calculateMarketContribution ─────────────────────────────────────────────

describe('calculateMarketContribution', () => {
  test('user buys YES at low price, market resolves YES → high contribution', () => {
    const bets = [{ type: 'BUY', side: 'YES', shares: 50, amount: 10 }];
    const result = calculateMarketContribution({ userBets: bets, resolution: 'YES' });
    expect(result).not.toBeNull();
    // avgEntryPrice = 10/50 = 0.20, contrarianBonus = 0.80, contribution = 50 * 0.80 = 40
    expect(result.avgEntryPrice).toBeCloseTo(0.2);
    expect(result.sharesOnCorrectSide).toBeCloseTo(50);
    expect(result.contribution).toBeCloseTo(40);
  });

  test('user buys YES at high price, market resolves YES → low contribution', () => {
    const bets = [{ type: 'BUY', side: 'YES', shares: 50, amount: 45 }];
    const result = calculateMarketContribution({ userBets: bets, resolution: 'YES' });
    expect(result).not.toBeNull();
    // avgEntryPrice = 45/50 = 0.90, contrarianBonus = 0.10, contribution = 50 * 0.10 = 5
    expect(result.avgEntryPrice).toBeCloseTo(0.9);
    expect(result.contribution).toBeCloseTo(5);
  });

  test('user buys YES, market resolves NO → null (no contribution)', () => {
    const bets = [{ type: 'BUY', side: 'YES', shares: 50, amount: 10 }];
    const result = calculateMarketContribution({ userBets: bets, resolution: 'NO' });
    expect(result).toBeNull();
  });

  test('user buys both YES and NO, only winning side counts (resolves YES)', () => {
    const bets = [
      { type: 'BUY', side: 'YES', shares: 30, amount: 9 },
      { type: 'BUY', side: 'NO', shares: 20, amount: 14 }
    ];
    const result = calculateMarketContribution({ userBets: bets, resolution: 'YES' });
    expect(result).not.toBeNull();
    // Only YES buys count: avgEntryPrice = 9/30 = 0.30, contrarianBonus = 0.70
    // contribution = 30 * 0.70 = 21
    expect(result.sharesOnCorrectSide).toBeCloseTo(30);
    expect(result.avgEntryPrice).toBeCloseTo(0.3);
    expect(result.contribution).toBeCloseTo(21);
  });

  test('user buys both YES and NO, only winning side counts (resolves NO)', () => {
    const bets = [
      { type: 'BUY', side: 'YES', shares: 30, amount: 9 },
      { type: 'BUY', side: 'NO', shares: 20, amount: 14 }
    ];
    const result = calculateMarketContribution({ userBets: bets, resolution: 'NO' });
    expect(result).not.toBeNull();
    // Only NO buys count: avgEntryPrice = 14/20 = 0.70, contrarianBonus = 0.30
    // contribution = 20 * 0.30 = 6
    expect(result.sharesOnCorrectSide).toBeCloseTo(20);
    expect(result.avgEntryPrice).toBeCloseTo(0.7);
    expect(result.contribution).toBeCloseTo(6);
  });

  test('user buys then sells ALL shares on correct side → netShares = 0, returns null', () => {
    const bets = [
      { type: 'BUY', side: 'YES', shares: 50, amount: 10 },
      { type: 'SELL', side: 'YES', shares: 50, amount: -10 }
    ];
    const result = calculateMarketContribution({ userBets: bets, resolution: 'YES' });
    expect(result).toBeNull();
  });

  test('user buys then partially sells → reduced netShares, avgEntryPrice based on buys only', () => {
    const bets = [
      { type: 'BUY', side: 'YES', shares: 50, amount: 10 },
      { type: 'SELL', side: 'YES', shares: 20, amount: -4 }
    ];
    const result = calculateMarketContribution({ userBets: bets, resolution: 'YES' });
    expect(result).not.toBeNull();
    // netShares = 50 - 20 = 30
    // avgEntryPrice (buys only) = 10/50 = 0.20, contrarianBonus = 0.80
    // contribution = 30 * 0.80 = 24
    expect(result.sharesOnCorrectSide).toBeCloseTo(30);
    expect(result.avgEntryPrice).toBeCloseTo(0.2);
    expect(result.contribution).toBeCloseTo(24);
  });

  test('refunded bets are excluded from calculation', () => {
    const bets = [
      { type: 'BUY', side: 'YES', shares: 50, amount: 10, refunded: true },
      { type: 'BUY', side: 'YES', shares: 20, amount: 4 }
    ];
    const result = calculateMarketContribution({ userBets: bets, resolution: 'YES' });
    expect(result).not.toBeNull();
    // Only the non-refunded bet counts: shares=20, amount=4
    // avgEntryPrice = 4/20 = 0.20, contribution = 20 * 0.80 = 16
    expect(result.sharesOnCorrectSide).toBeCloseTo(20);
    expect(result.avgEntryPrice).toBeCloseTo(0.2);
    expect(result.contribution).toBeCloseTo(16);
  });

  test('all bets refunded → returns null', () => {
    const bets = [
      { type: 'BUY', side: 'YES', shares: 50, amount: 10, refunded: true }
    ];
    const result = calculateMarketContribution({ userBets: bets, resolution: 'YES' });
    expect(result).toBeNull();
  });

  test('multiple buys at different prices → weighted average entry price', () => {
    const bets = [
      { type: 'BUY', side: 'YES', shares: 30, amount: 6 },  // price = 0.20
      { type: 'BUY', side: 'YES', shares: 20, amount: 8 }   // price = 0.40
    ];
    const result = calculateMarketContribution({ userBets: bets, resolution: 'YES' });
    expect(result).not.toBeNull();
    // Weighted avg: (0.20*30 + 0.40*20) / 50 = (6 + 8) / 50 = 14/50 = 0.28
    // netShares = 50, contrarianBonus = 0.72, contribution = 50 * 0.72 = 36
    expect(result.sharesOnCorrectSide).toBeCloseTo(50);
    expect(result.avgEntryPrice).toBeCloseTo(0.28);
    expect(result.contribution).toBeCloseTo(36);
  });

  test('user with only SELL trades on a market → no contribution (null)', () => {
    const bets = [
      { type: 'SELL', side: 'YES', shares: 20, amount: -5 }
    ];
    const result = calculateMarketContribution({ userBets: bets, resolution: 'YES' });
    expect(result).toBeNull();
  });

  test('empty userBets → returns null', () => {
    const result = calculateMarketContribution({ userBets: [], resolution: 'YES' });
    expect(result).toBeNull();
  });

  test('invalid resolution → returns null', () => {
    const bets = [{ type: 'BUY', side: 'YES', shares: 50, amount: 10 }];
    expect(calculateMarketContribution({ userBets: bets, resolution: null })).toBeNull();
    expect(calculateMarketContribution({ userBets: bets, resolution: 'CANCELLED' })).toBeNull();
  });

  test('entry price at 100% (amount equals shares) → contrarian bonus = 0, returns null', () => {
    // Buying at certainty earns no contrarian bonus
    const bets = [{ type: 'BUY', side: 'YES', shares: 50, amount: 50 }];
    const result = calculateMarketContribution({ userBets: bets, resolution: 'YES' });
    expect(result).toBeNull();
  });
});

// ─── calculateUserOracleScore ─────────────────────────────────────────────────

describe('calculateUserOracleScore', () => {
  test('aggregate score across multiple markets sums correctly', () => {
    const bets = [
      // Market A: YES resolves YES, bought at 0.20 → contribution = 50 * 0.80 = 40
      { marketId: 'mA', type: 'BUY', side: 'YES', shares: 50, amount: 10 },
      // Market B: YES resolves YES, bought at 0.40 → contribution = 25 * 0.60 = 15
      { marketId: 'mB', type: 'BUY', side: 'YES', shares: 25, amount: 10 }
    ];
    const marketsById = {
      mA: { resolution: 'YES', status: 'RESOLVED' },
      mB: { resolution: 'YES', status: 'RESOLVED' }
    };
    const { oracleScore, marketsScored, details } = calculateUserOracleScore({ bets, marketsById });
    expect(marketsScored).toBe(2);
    expect(oracleScore).toBeCloseTo(40 + 15); // 55
    expect(details).toHaveLength(2);
  });

  test('cancelled markets are excluded', () => {
    const bets = [
      { marketId: 'mA', type: 'BUY', side: 'YES', shares: 50, amount: 10 },
      { marketId: 'mB', type: 'BUY', side: 'YES', shares: 50, amount: 10 }
    ];
    const marketsById = {
      mA: { resolution: 'YES', status: 'RESOLVED' },
      mB: { resolution: 'YES', status: 'CANCELLED' }
    };
    const { oracleScore, marketsScored } = calculateUserOracleScore({ bets, marketsById });
    expect(marketsScored).toBe(1);
    expect(oracleScore).toBeCloseTo(40);
  });

  test('markets not in marketsById are skipped', () => {
    const bets = [
      { marketId: 'mUnknown', type: 'BUY', side: 'YES', shares: 50, amount: 10 }
    ];
    const { oracleScore, marketsScored } = calculateUserOracleScore({ bets, marketsById: {} });
    expect(marketsScored).toBe(0);
    expect(oracleScore).toBe(0);
  });

  test('refunded bets in the bets array are excluded', () => {
    const bets = [
      { marketId: 'mA', type: 'BUY', side: 'YES', shares: 50, amount: 10, refunded: true }
    ];
    const marketsById = { mA: { resolution: 'YES', status: 'RESOLVED' } };
    const { oracleScore, marketsScored } = calculateUserOracleScore({ bets, marketsById });
    expect(marketsScored).toBe(0);
    expect(oracleScore).toBe(0);
  });

  test('unresolved markets (no resolution) are skipped', () => {
    const bets = [
      { marketId: 'mA', type: 'BUY', side: 'YES', shares: 50, amount: 10 }
    ];
    const marketsById = { mA: { resolution: null, status: 'OPEN' } };
    const { oracleScore, marketsScored } = calculateUserOracleScore({ bets, marketsById });
    expect(marketsScored).toBe(0);
    expect(oracleScore).toBe(0);
  });

  test('wrong-side bets contribute 0 to oracle score', () => {
    const bets = [
      { marketId: 'mA', type: 'BUY', side: 'YES', shares: 50, amount: 10 }
    ];
    const marketsById = { mA: { resolution: 'NO', status: 'RESOLVED' } };
    const { oracleScore, marketsScored } = calculateUserOracleScore({ bets, marketsById });
    expect(marketsScored).toBe(0);
    expect(oracleScore).toBe(0);
  });

  test('zero bets returns zero score', () => {
    const { oracleScore, marketsScored, details } = calculateUserOracleScore({ bets: [], marketsById: {} });
    expect(oracleScore).toBe(0);
    expect(marketsScored).toBe(0);
    expect(details).toHaveLength(0);
  });

  test('details array contains per-market breakdown', () => {
    const bets = [
      { marketId: 'mA', type: 'BUY', side: 'YES', shares: 50, amount: 10 }
    ];
    const marketsById = { mA: { resolution: 'YES', status: 'RESOLVED' } };
    const { details } = calculateUserOracleScore({ bets, marketsById });
    expect(details).toHaveLength(1);
    expect(details[0].marketId).toBe('mA');
    expect(details[0].contribution).toBeCloseTo(40);
    expect(details[0].sharesOnCorrectSide).toBeCloseTo(50);
    expect(details[0].avgEntryPrice).toBeCloseTo(0.2);
  });
});
