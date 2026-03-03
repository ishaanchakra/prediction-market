import { calculateMarketContribution, calculateUserOracleScore } from '../oracleScore';

function ts(ms) {
  return {
    toMillis: () => ms,
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1e6
  };
}

describe('calculateMarketContribution', () => {
  test('returns null if no bets', () => {
    expect(calculateMarketContribution({ userBets: [], resolution: 'YES' })).toBeNull();
  });

  test('returns null if last action has no probability fields', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [
        { type: 'BUY', side: 'YES', shares: 3, marketProbabilityAtBet: 0.2, createdAt: ts(100) },
        { type: 'SELL', side: 'YES', shares: 1, createdAt: ts(200) }
      ]
    });
    expect(result).toBeNull();
  });

  test('returns null when position is fully exited before resolution', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [
        { type: 'BUY', side: 'YES', shares: 2, marketProbabilityAtBet: 0.3, createdAt: ts(100) },
        { type: 'SELL', side: 'YES', shares: 2, marketProbabilityAtBet: 0.7, createdAt: ts(200) }
      ]
    });
    expect(result).toBeNull();
  });

  test('YES buy at 0.3 resolving YES scores as contrarian win', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [{ type: 'BUY', side: 'YES', shares: 1, marketProbabilityAtBet: 0.3, createdAt: ts(100) }]
    });

    expect(result).toEqual({
      brierScore: expect.closeTo(0.91, 8),
      impliedProbability: expect.closeTo(0.7, 8),
      lastActionType: 'BUY_YES'
    });
  });

  test('YES buy at 0.8 resolving YES -> 0.96', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [{ type: 'BUY', side: 'YES', shares: 1, marketProbabilityAtBet: 0.8, createdAt: ts(100) }]
    });
    expect(result?.impliedProbability).toBeCloseTo(0.8, 8);
    expect(result?.brierScore).toBeCloseTo(0.96, 8);
  });

  test('YES buy at 0.8 resolving NO -> 0.36', () => {
    const result = calculateMarketContribution({
      resolution: 'NO',
      userBets: [{ type: 'BUY', side: 'YES', shares: 1, marketProbabilityAtBet: 0.8, createdAt: ts(100) }]
    });
    expect(result?.impliedProbability).toBeCloseTo(0.8, 8);
    expect(result?.brierScore).toBeCloseTo(0.36, 8);
  });

  test('NO buy at 0.3 resolving NO -> 0.91', () => {
    const result = calculateMarketContribution({
      resolution: 'NO',
      userBets: [{ type: 'BUY', side: 'NO', shares: 1, marketProbabilityAtBet: 0.3, createdAt: ts(100) }]
    });
    expect(result?.impliedProbability).toBeCloseTo(0.3, 8);
    expect(result?.brierScore).toBeCloseTo(0.91, 8);
    expect(result?.lastActionType).toBe('BUY_NO');
  });

  test('NO buy at 0.7 resolving YES -> 0.51', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [{ type: 'BUY', side: 'NO', shares: 1, marketProbabilityAtBet: 0.7, createdAt: ts(100) }]
    });
    expect(result?.impliedProbability).toBeCloseTo(0.3, 8);
    expect(result?.brierScore).toBeCloseTo(0.51, 8);
  });

  test('NO buy at 0.7 resolving NO -> 0.91', () => {
    const result = calculateMarketContribution({
      resolution: 'NO',
      userBets: [{ type: 'BUY', side: 'NO', shares: 1, marketProbabilityAtBet: 0.7, createdAt: ts(100) }]
    });
    expect(result?.impliedProbability).toBeCloseTo(0.3, 8);
    expect(result?.brierScore).toBeCloseTo(0.91, 8);
  });

  test('fallback to probability: all-in NO to 5% resolving YES -> near 0', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [{ type: 'BUY', side: 'NO', shares: 4, probability: 0.05, createdAt: ts(100) }]
    });
    expect(result?.impliedProbability).toBeCloseTo(0.05, 8);
    expect(result?.brierScore).toBeCloseTo(0.0975, 8);
  });

  test('marketProbabilityAtBet takes precedence over probability', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [{ type: 'BUY', side: 'YES', shares: 1, marketProbabilityAtBet: 0.8, probability: 0.2, createdAt: ts(100) }]
    });
    expect(result?.impliedProbability).toBeCloseTo(0.8, 8);
  });

  test('last action wins while net position remains open', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [
        { type: 'BUY', side: 'YES', shares: 2, marketProbabilityAtBet: 0.3, createdAt: ts(100) },
        { type: 'SELL', side: 'YES', shares: 1, marketProbabilityAtBet: 0.7, createdAt: ts(200) }
      ]
    });
    expect(result?.impliedProbability).toBeCloseTo(0.7, 8);
    expect(result?.lastActionType).toBe('SELL_YES');
    expect(result?.brierScore).toBeCloseTo(0.91, 8);
  });

  test('refunded bets are excluded from last action selection', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [
        { type: 'BUY', side: 'YES', shares: 1, marketProbabilityAtBet: 0.2, createdAt: ts(100) },
        { type: 'SELL', side: 'YES', shares: 1, marketProbabilityAtBet: 0.9, refunded: true, createdAt: ts(300) }
      ]
    });
    expect(result?.lastActionType).toBe('BUY_YES');
    expect(result?.impliedProbability).toBeCloseTo(0.8, 8);
  });
});

describe('calculateUserOracleScore', () => {
  test('single perfect market -> oracle score near 100', () => {
    const bets = [{ marketId: 'm1', type: 'BUY', side: 'YES', shares: 1, marketProbabilityAtBet: 1, createdAt: ts(100) }];
    const marketsById = { m1: { resolution: 'YES', status: 'RESOLVED' } };

    const result = calculateUserOracleScore({ bets, marketsById });
    expect(result.rawBrierAvg).toBeCloseTo(1, 8);
    expect(result.oracleScore).toBeCloseTo(100, 8);
    expect(result.marketsScored).toBe(1);
  });

  test('single 50/50 market -> raw 0.75 and display 0', () => {
    const bets = [{ marketId: 'm1', type: 'BUY', side: 'YES', shares: 1, marketProbabilityAtBet: 0.5, createdAt: ts(100) }];
    const marketsById = { m1: { resolution: 'YES', status: 'RESOLVED' } };

    const result = calculateUserOracleScore({ bets, marketsById });
    expect(result.rawBrierAvg).toBeCloseTo(0.75, 8);
    expect(result.oracleScore).toBeCloseTo(0, 8);
    expect(result.marketsScored).toBe(1);
  });

  test('multiple markets average correctly', () => {
    const bets = [
      { marketId: 'm1', type: 'BUY', side: 'YES', shares: 1, marketProbabilityAtBet: 1, createdAt: ts(100) },
      { marketId: 'm2', type: 'BUY', side: 'YES', shares: 1, marketProbabilityAtBet: 0.5, createdAt: ts(100) }
    ];
    const marketsById = {
      m1: { resolution: 'YES', status: 'RESOLVED' },
      m2: { resolution: 'YES', status: 'RESOLVED' }
    };

    const result = calculateUserOracleScore({ bets, marketsById });
    const expectedAvg = (1 + 0.75) / 2;
    const expectedDisplay = ((expectedAvg - 0.75) / 0.25) * 100;

    expect(result.rawBrierAvg).toBeCloseTo(expectedAvg, 8);
    expect(result.oracleScore).toBeCloseTo(expectedDisplay, 8);
    expect(result.marketsScored).toBe(2);
  });

  test('markets without probability fields are skipped', () => {
    const bets = [{ marketId: 'm1', type: 'BUY', side: 'YES', shares: 1, createdAt: ts(100) }];
    const marketsById = { m1: { resolution: 'YES', status: 'RESOLVED' } };

    const result = calculateUserOracleScore({ bets, marketsById });
    expect(result.marketsScored).toBe(0);
    expect(result.oracleScore).toBe(0);
    expect(result.rawBrierAvg).toBe(0);
  });

  test('negative rescaled scores are clamped to 0', () => {
    const bets = [{ marketId: 'm1', type: 'BUY', side: 'YES', shares: 1, marketProbabilityAtBet: 0.8, createdAt: ts(100) }];
    const marketsById = { m1: { resolution: 'NO', status: 'RESOLVED' } };

    const result = calculateUserOracleScore({ bets, marketsById });
    expect(result.rawBrierAvg).toBeCloseTo(0.36, 8);
    expect(result.oracleScore).toBe(0);
  });

  test('cancelled markets are skipped', () => {
    const bets = [{ marketId: 'm1', type: 'BUY', side: 'YES', shares: 1, marketProbabilityAtBet: 0.9, createdAt: ts(100) }];
    const marketsById = { m1: { resolution: 'YES', status: 'CANCELLED' } };

    const result = calculateUserOracleScore({ bets, marketsById });
    expect(result.marketsScored).toBe(0);
    expect(result.details).toEqual([]);
  });

  test('details include per-market breakdown using final action', () => {
    const bets = [
      { marketId: 'm1', type: 'BUY', side: 'NO', shares: 2, marketProbabilityAtBet: 0.6, createdAt: ts(100) },
      { marketId: 'm1', type: 'SELL', side: 'NO', shares: 1, marketProbabilityAtBet: 0.4, createdAt: ts(200) }
    ];
    const marketsById = { m1: { resolution: 'YES', status: 'RESOLVED' } };

    const result = calculateUserOracleScore({ bets, marketsById });

    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toEqual({
      marketId: 'm1',
      brierScore: expect.any(Number),
      impliedProbability: expect.any(Number),
      resolution: 'YES',
      lastActionType: 'SELL_NO'
    });
    expect(result.details[0].impliedProbability).toBeCloseTo(0.4, 8);
    expect(result.details[0].brierScore).toBeCloseTo(0.64, 8);
  });

  test('all-in NO on YES market clamps display score to 0', () => {
    const bets = [{ marketId: 'm1', type: 'BUY', side: 'NO', shares: 4, probability: 0.05, createdAt: ts(100) }];
    const marketsById = { m1: { resolution: 'YES', status: 'RESOLVED' } };

    const result = calculateUserOracleScore({ bets, marketsById });
    expect(result.marketsScored).toBe(1);
    expect(result.rawBrierAvg).toBeCloseTo(0.0975, 4);
    expect(result.oracleScore).toBe(0);
  });
});
