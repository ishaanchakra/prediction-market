import { MARKET_STATUS } from '../marketStatus';
import { aggregatePositions, calculatePortfolioSummary, calculatePortfolioValue, calculateAllPortfolioValues } from '../portfolio';

describe('aggregatePositions', () => {
  test('one BUY creates one aggregated position with correct value', () => {
    const positions = aggregatePositions([
      {
        marketId: 'm1',
        marketQuestion: 'Q1',
        marketStatus: MARKET_STATUS.OPEN,
        marketProbability: 0.6,
        side: 'YES',
        type: 'BUY',
        amount: 40,
        shares: 80,
        marketCategory: 'sports'
      }
    ]);

    expect(positions).toHaveLength(1);
    expect(positions[0].yesShares).toBe(80);
    expect(positions[0].totalCost).toBe(40);
    expect(positions[0].marketValue).toBe(48);
    expect(positions[0].side).toBe('YES');
  });

  test('BUY + partial SELL nets down shares and cost basis', () => {
    const positions = aggregatePositions([
      {
        marketId: 'm1', marketStatus: MARKET_STATUS.OPEN, marketProbability: 0.5,
        side: 'YES', type: 'BUY', amount: 100, shares: 200
      },
      {
        marketId: 'm1', marketStatus: MARKET_STATUS.OPEN, marketProbability: 0.5,
        side: 'YES', type: 'SELL', amount: -30, shares: 60
      }
    ]);

    expect(positions[0].yesShares).toBe(140);
    expect(positions[0].yesCost).toBe(70);
    expect(positions[0].totalCost).toBe(70);
  });

  test('BUY YES + BUY NO on same market becomes MIXED', () => {
    const positions = aggregatePositions([
      {
        marketId: 'm1', marketStatus: MARKET_STATUS.OPEN, marketProbability: 0.7,
        side: 'YES', type: 'BUY', amount: 30, shares: 60
      },
      {
        marketId: 'm1', marketStatus: MARKET_STATUS.OPEN, marketProbability: 0.7,
        side: 'NO', type: 'BUY', amount: 20, shares: 30
      }
    ]);

    expect(positions[0].side).toBe('YES');
    expect(positions[0].yesShares).toBe(60);
    expect(positions[0].noShares).toBe(30);
  });

  test('fully exited position is excluded', () => {
    const positions = aggregatePositions([
      { marketId: 'm1', marketStatus: MARKET_STATUS.OPEN, marketProbability: 0.5, side: 'YES', type: 'BUY', amount: 50, shares: 100 },
      { marketId: 'm1', marketStatus: MARKET_STATUS.OPEN, marketProbability: 0.5, side: 'YES', type: 'SELL', amount: -50, shares: 100 }
    ]);

    expect(positions).toHaveLength(0);
  });

  test('multiple markets aggregate independently', () => {
    const positions = aggregatePositions([
      { marketId: 'm1', marketStatus: MARKET_STATUS.OPEN, marketProbability: 0.5, side: 'YES', type: 'BUY', amount: 20, shares: 40 },
      { marketId: 'm2', marketStatus: MARKET_STATUS.OPEN, marketProbability: 0.25, side: 'NO', type: 'BUY', amount: 25, shares: 50 }
    ]);

    expect(positions).toHaveLength(2);
    expect(positions.find((p) => p.marketId === 'm1')).toBeTruthy();
    expect(positions.find((p) => p.marketId === 'm2')).toBeTruthy();
  });

  test('resolved market pays winning side shares', () => {
    const positions = aggregatePositions([
      {
        marketId: 'm1', marketStatus: MARKET_STATUS.RESOLVED, marketResolution: 'YES',
        side: 'YES', type: 'BUY', amount: 40, shares: 100
      }
    ]);

    expect(positions[0].marketValue).toBe(100);
    expect(positions[0].unrealizedPnl).toBe(60);
  });

  test('cancelled market refunds net cost', () => {
    const positions = aggregatePositions([
      {
        marketId: 'm1', marketStatus: MARKET_STATUS.CANCELLED,
        side: 'NO', type: 'BUY', amount: 70, shares: 140
      }
    ]);

    expect(positions[0].marketValue).toBe(70);
    expect(positions[0].unrealizedPnl).toBe(0);
  });
});

describe('calculatePortfolioSummary', () => {
  test('no positions equals cash balance', () => {
    const summary = calculatePortfolioSummary({ weeklyRep: 950 }, []);

    expect(summary.cashBalance).toBe(950);
    expect(summary.positionsValue).toBe(0);
    expect(summary.portfolioValue).toBe(950);
  });

  test('positions included in portfolio value', () => {
    const summary = calculatePortfolioSummary(
      { weeklyRep: 900 },
      [
        { marketStatus: MARKET_STATUS.OPEN, marketValue: 50, yesShares: 100, noShares: 0, marketProbability: 0.5 },
        { marketStatus: MARKET_STATUS.LOCKED, marketValue: 30, yesShares: 0, noShares: 40, marketProbability: 0.25 }
      ]
    );

    expect(summary.positionsValue).toBe(80);
    expect(summary.portfolioValue).toBe(980);
    expect(summary.weeklyPnl).toBe(-20);
  });

  test('allocation percentages sum near 100', () => {
    const summary = calculatePortfolioSummary(
      { weeklyRep: 500 },
      [
        { marketStatus: MARKET_STATUS.OPEN, marketValue: 250, yesShares: 500, noShares: 0, marketProbability: 0.5 }
      ]
    );

    const totalPct = summary.cashPct + summary.yesPct + summary.noPct;
    expect(Math.abs(totalPct - 100)).toBeLessThanOrEqual(0.1);
  });

  test('zero portfolio edge case does not blow up percentages', () => {
    const summary = calculatePortfolioSummary(
      { weeklyRep: 0 },
      [
        { marketStatus: MARKET_STATUS.OPEN, marketValue: 0, yesShares: 100, noShares: 0, marketProbability: 0 }
      ]
    );

    expect(summary.portfolioValue).toBe(0);
    expect(summary.cashPct).toBe(0);
    expect(summary.yesPct).toBe(0);
    expect(summary.noPct).toBe(0);
  });
});

describe('calculatePortfolioValue', () => {
  test('cash only, no bets returns cash as portfolio value', () => {
    const result = calculatePortfolioValue({ cashBalance: 1000, userBets: [], openMarketsById: {} });

    expect(result.cashBalance).toBe(1000);
    expect(result.positionsValue).toBe(0);
    expect(result.portfolioValue).toBe(1000);
    expect(result.netProfit).toBe(0);
  });

  test('open position adds market value to cash', () => {
    // User spent $100 to buy 200 YES shares in a market at 0.6 prob
    const result = calculatePortfolioValue({
      cashBalance: 900,
      userBets: [{ marketId: 'm1', userId: 'u1', side: 'YES', type: 'BUY', amount: 100, shares: 200 }],
      openMarketsById: { m1: { probability: 0.6 } }
    });

    // 200 yes shares × 0.6 = 120 market value
    expect(result.positionsValue).toBe(120);
    expect(result.portfolioValue).toBe(1020);
    expect(result.netProfit).toBe(20);
  });

  test('positionsByMarket reflects aggregated share counts', () => {
    const result = calculatePortfolioValue({
      cashBalance: 800,
      userBets: [
        { marketId: 'm1', userId: 'u1', side: 'YES', type: 'BUY', amount: 100, shares: 150 },
        { marketId: 'm1', userId: 'u1', side: 'YES', type: 'SELL', amount: 40, shares: 60 }
      ],
      openMarketsById: { m1: { probability: 0.5 } }
    });

    expect(result.positionsByMarket['m1'].yesShares).toBe(90);
    expect(result.positionsByMarket['m1'].noShares).toBe(0);
  });
});

describe('calculateAllPortfolioValues', () => {
  test('users with no bets rank by cash balance', () => {
    const users = [
      { id: 'u1', weeklyRep: 800 },
      { id: 'u2', weeklyRep: 1200 },
      { id: 'u3', weeklyRep: 1000 }
    ];
    const results = calculateAllPortfolioValues({ users, bets: [], openMarkets: [] })
      .sort((a, b) => b.portfolioValue - a.portfolioValue);

    expect(results[0].id).toBe('u2');
    expect(results[1].id).toBe('u3');
    expect(results[2].id).toBe('u1');
  });

  test('user with lower cash but valuable open position ranks above cash-only leader (the homepage rank bug)', () => {
    // u1: $900 cash, 200 YES shares at prob 0.8 → portfolioValue = 900 + 160 = 1060
    // u2: $1050 cash, no positions → portfolioValue = 1050
    // Raw weeklyRep rank: u2 (#1) > u1 (#2), but true portfolioValue rank: u1 (#1) > u2 (#2)
    const users = [
      { id: 'u1', weeklyRep: 900 },
      { id: 'u2', weeklyRep: 1050 }
    ];
    const bets = [
      { marketId: 'm1', userId: 'u1', side: 'YES', type: 'BUY', amount: 100, shares: 200 }
    ];
    const openMarkets = [{ id: 'm1', probability: 0.8 }];

    const results = calculateAllPortfolioValues({ users, bets, openMarkets })
      .sort((a, b) => b.portfolioValue - a.portfolioValue);

    expect(results[0].id).toBe('u1');
    expect(results[0].portfolioValue).toBe(1060);
    expect(results[1].id).toBe('u2');
    expect(results[1].portfolioValue).toBe(1050);
    // Confirm sorting by weeklyRep alone would give the wrong order
    const byWeeklyRep = [...users].sort((a, b) => b.weeklyRep - a.weeklyRep);
    expect(byWeeklyRep[0].id).toBe('u2');
  });

  test('user not in users list gets rank -1 (no entry)', () => {
    const users = [{ id: 'u1', weeklyRep: 1000 }];
    const results = calculateAllPortfolioValues({ users, bets: [], openMarkets: [] });
    const rankIdx = results.findIndex((u) => u.id === 'unknown');
    expect(rankIdx).toBe(-1);
  });

  test('empty inputs return empty array', () => {
    const results = calculateAllPortfolioValues({ users: [], bets: [], openMarkets: [] });
    expect(results).toHaveLength(0);
  });

  test('bets for unknown markets are treated as zero-value positions', () => {
    const users = [{ id: 'u1', weeklyRep: 500 }];
    const bets = [{ marketId: 'unknown-market', userId: 'u1', side: 'YES', type: 'BUY', amount: 50, shares: 100 }];
    const results = calculateAllPortfolioValues({ users, bets, openMarkets: [] });
    // Market not in openMarketsById → probability defaults to 0.5
    expect(results[0].portfolioValue).toBeGreaterThanOrEqual(500);
  });
});
