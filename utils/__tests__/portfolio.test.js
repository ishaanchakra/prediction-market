import { MARKET_STATUS } from '../marketStatus';
import { aggregatePositions, calculatePortfolioSummary } from '../portfolio';

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
