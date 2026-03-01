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

  test('returns null if neither marketProbabilityAtBet nor probability on last action', () => {
    // Last action is the SELL (more recent), which has neither field
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [
        { type: 'BUY', side: 'YES', marketProbabilityAtBet: 0.2, createdAt: ts(100) },
        { type: 'SELL', side: 'YES', createdAt: ts(200) }
      ]
    });
    expect(result).toBeNull();
  });

  // ── YES BUY cases ────────────────────────────────────────────────────────

  test('YES BUY at 0.3, resolves YES -> brier 0.51', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [{ type: 'BUY', side: 'YES', marketProbabilityAtBet: 0.3, createdAt: ts(100) }]
    });

    expect(result).toEqual({
      brierScore: expect.closeTo(0.51, 8),
      impliedProbability: expect.closeTo(0.3, 8),
      lastActionType: 'BUY_YES'
    });
  });

  test('YES BUY at 0.8, resolves YES -> brier 0.96', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [{ type: 'BUY', side: 'YES', marketProbabilityAtBet: 0.8, createdAt: ts(100) }]
    });
    expect(result?.brierScore).toBeCloseTo(0.96, 8);
    expect(result?.impliedProbability).toBeCloseTo(0.8, 8);
  });

  test('YES BUY at 0.8, resolves NO -> brier 0.36', () => {
    const result = calculateMarketContribution({
      resolution: 'NO',
      userBets: [{ type: 'BUY', side: 'YES', marketProbabilityAtBet: 0.8, createdAt: ts(100) }]
    });
    expect(result?.brierScore).toBeCloseTo(0.36, 8);
    expect(result?.impliedProbability).toBeCloseTo(0.8, 8);
  });

  // ── NO BUY cases ─────────────────────────────────────────────────────────
  // impliedProbability is P(YES) at bet time — no side flip.
  // A NO buyer at P(YES)=0.3 accepted 0.3 as the market price; that IS their implied P(YES).

  test('NO BUY at marketProbabilityAtBet 0.3, resolves NO -> brier 0.91', () => {
    // P(YES)=0.3 when they bet. They bet NO correctly. Good calibration -> high score.
    const result = calculateMarketContribution({
      resolution: 'NO',
      userBets: [{ type: 'BUY', side: 'NO', marketProbabilityAtBet: 0.3, createdAt: ts(100) }]
    });
    // impliedProbability = 0.3, outcome=0, error = 0-0.3 = -0.3, brierScore = 1 - 0.09 = 0.91
    expect(result?.impliedProbability).toBeCloseTo(0.3, 8);
    expect(result?.brierScore).toBeCloseTo(0.91, 8);
    expect(result?.lastActionType).toBe('BUY_NO');
  });

  test('NO BUY at marketProbabilityAtBet 0.7, resolves YES -> brier 0.51', () => {
    // P(YES)=0.7 when they bet NO. They bet against the favourite and lost.
    // Same score as YES buyer at 0.3 who was right — symmetry by probability level.
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [{ type: 'BUY', side: 'NO', marketProbabilityAtBet: 0.7, createdAt: ts(100) }]
    });
    // impliedProbability = 0.7, outcome=1, error = 1-0.7 = 0.3, brierScore = 1 - 0.09 = 0.91
    expect(result?.impliedProbability).toBeCloseTo(0.7, 8);
    expect(result?.brierScore).toBeCloseTo(0.91, 8);
  });

  test('NO BUY at marketProbabilityAtBet 0.7, resolves NO -> brier 0.51', () => {
    // P(YES)=0.7 when they bet NO. They were right but the market strongly disagreed.
    const result = calculateMarketContribution({
      resolution: 'NO',
      userBets: [{ type: 'BUY', side: 'NO', marketProbabilityAtBet: 0.7, createdAt: ts(100) }]
    });
    // impliedProbability = 0.7, outcome=0, error = 0-0.7 = -0.7, brierScore = 1 - 0.49 = 0.51
    expect(result?.impliedProbability).toBeCloseTo(0.7, 8);
    expect(result?.brierScore).toBeCloseTo(0.51, 8);
  });

  // ── Fallback to `probability` (post-bet) for old bets ───────────────────

  test('CMC556 scenario: large NO bet, post-bet probability=0.05, resolves YES -> near 0 pts', () => {
    // No marketProbabilityAtBet (old bet). Large NO bet moved market from ~50% to ~5%.
    // Post-bet probability=0.05 is the fallback. impliedProbability=0.05.
    // outcome=1 (YES), error=0.95, brierScore=1-0.9025=0.0975 -> display ~0.
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [{ type: 'BUY', side: 'NO', probability: 0.05, createdAt: ts(100) }]
    });
    expect(result?.impliedProbability).toBeCloseTo(0.05, 8);
    expect(result?.brierScore).toBeCloseTo(0.0975, 8);
  });

  test('fallback YES bet: post-bet probability=0.9, resolves YES -> high score', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [{ type: 'BUY', side: 'YES', probability: 0.9, createdAt: ts(100) }]
    });
    // brierScore = 1 - (1-0.9)^2 = 0.99
    expect(result?.impliedProbability).toBeCloseTo(0.9, 8);
    expect(result?.brierScore).toBeCloseTo(0.99, 8);
  });

  test('marketProbabilityAtBet takes precedence over probability', () => {
    // marketProbabilityAtBet=0.8 should be used, not probability=0.2
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [{ type: 'BUY', side: 'YES', marketProbabilityAtBet: 0.8, probability: 0.2, createdAt: ts(100) }]
    });
    expect(result?.impliedProbability).toBeCloseTo(0.8, 8);
  });

  // ── Multi-bet / ordering ─────────────────────────────────────────────────

  test('last action wins (BUY YES 0.3 then SELL YES 0.7)', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [
        { type: 'BUY', side: 'YES', marketProbabilityAtBet: 0.3, createdAt: ts(100) },
        { type: 'SELL', side: 'YES', marketProbabilityAtBet: 0.7, createdAt: ts(200) }
      ]
    });
    expect(result?.impliedProbability).toBeCloseTo(0.7, 8);
    expect(result?.lastActionType).toBe('SELL_YES');
    expect(result?.brierScore).toBeCloseTo(0.91, 8);
  });

  test('refunded bets excluded from last action consideration', () => {
    const result = calculateMarketContribution({
      resolution: 'YES',
      userBets: [
        { type: 'BUY', side: 'YES', marketProbabilityAtBet: 0.2, createdAt: ts(100) },
        { type: 'SELL', side: 'YES', marketProbabilityAtBet: 0.9, refunded: true, createdAt: ts(300) }
      ]
    });
    expect(result?.lastActionType).toBe('BUY_YES');
    expect(result?.impliedProbability).toBeCloseTo(0.2, 8);
  });
});

describe('calculateUserOracleScore', () => {
  test('single market, perfect score -> oracleScore near 100', () => {
    const bets = [{ marketId: 'm1', type: 'BUY', side: 'YES', marketProbabilityAtBet: 1, createdAt: ts(100) }];
    const marketsById = { m1: { resolution: 'YES', status: 'RESOLVED' } };

    const result = calculateUserOracleScore({ bets, marketsById });
    expect(result.rawBrierAvg).toBeCloseTo(1, 8);
    expect(result.oracleScore).toBeCloseTo(100, 8);
    expect(result.marketsScored).toBe(1);
  });

  test('single market implied 0.5 -> raw brier 0.75 -> display 0', () => {
    const bets = [{ marketId: 'm1', type: 'BUY', side: 'YES', marketProbabilityAtBet: 0.5, createdAt: ts(100) }];
    const marketsById = { m1: { resolution: 'YES', status: 'RESOLVED' } };

    const result = calculateUserOracleScore({ bets, marketsById });
    expect(result.rawBrierAvg).toBeCloseTo(0.75, 8);
    expect(result.oracleScore).toBeCloseTo(0, 8);
    expect(result.marketsScored).toBe(1);
  });

  test('multiple markets averages correctly', () => {
    const bets = [
      { marketId: 'm1', type: 'BUY', side: 'YES', marketProbabilityAtBet: 1, createdAt: ts(100) },
      { marketId: 'm2', type: 'BUY', side: 'YES', marketProbabilityAtBet: 0.5, createdAt: ts(100) }
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

  test('markets without either probability field are skipped', () => {
    const bets = [{ marketId: 'm1', type: 'BUY', side: 'YES', createdAt: ts(100) }];
    const marketsById = { m1: { resolution: 'YES', status: 'RESOLVED' } };

    const result = calculateUserOracleScore({ bets, marketsById });
    expect(result.marketsScored).toBe(0);
    expect(result.oracleScore).toBe(0);
    expect(result.rawBrierAvg).toBe(0);
  });

  test('negative rescaled scores are clamped to 0', () => {
    const bets = [{ marketId: 'm1', type: 'BUY', side: 'YES', marketProbabilityAtBet: 0.8, createdAt: ts(100) }];
    const marketsById = { m1: { resolution: 'NO', status: 'RESOLVED' } };

    const result = calculateUserOracleScore({ bets, marketsById });
    expect(result.rawBrierAvg).toBeCloseTo(0.36, 8);
    expect(result.oracleScore).toBe(0);
  });

  test('details array contains per-market breakdown', () => {
    const bets = [{ marketId: 'm1', type: 'SELL', side: 'NO', marketProbabilityAtBet: 0.4, createdAt: ts(200) }];
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
    // SELL NO at 0.4, resolves YES: impliedProbability=0.4, brierScore=1-(0.6)^2=0.64
    expect(result.details[0].impliedProbability).toBeCloseTo(0.4, 8);
    expect(result.details[0].brierScore).toBeCloseTo(0.64, 8);
  });

  test('CMC556 scenario end-to-end: all-in NO on YES market -> near 0 oracle score', () => {
    // Large NO bet pushed post-bet probability to 0.05. Market resolved YES.
    const bets = [{ marketId: 'm1', type: 'BUY', side: 'NO', probability: 0.05, createdAt: ts(100) }];
    const marketsById = { m1: { resolution: 'YES', status: 'RESOLVED' } };

    const result = calculateUserOracleScore({ bets, marketsById });
    // brierScore = 1 - (1-0.05)^2 = 0.0975 → rawBrierAvg 0.0975 → display 0 (clamped)
    expect(result.marketsScored).toBe(1);
    expect(result.rawBrierAvg).toBeCloseTo(0.0975, 4);
    expect(result.oracleScore).toBe(0);
  });
});
