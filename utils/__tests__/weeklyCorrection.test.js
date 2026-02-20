import { calculateWeeklyCorrectionRows } from '../weeklyCorrection';

describe('calculateWeeklyCorrectionRows', () => {
  test('calculates correction score for correct contrarian buys', () => {
    const users = [{ id: 'u1', displayName: 'Alice' }];
    const resolvedMarkets = [{ id: 'm1', resolution: 'YES', status: 'RESOLVED' }];
    const bets = [{ userId: 'u1', marketId: 'm1', marketplaceId: null, type: 'BUY', side: 'YES', shares: 50, amount: 10 }];

    const rows = calculateWeeklyCorrectionRows({ users, resolvedMarkets, bets });

    expect(rows).toHaveLength(1);
    expect(rows[0].weeklyResolvedMarkets).toBe(1);
    expect(rows[0].weeklyCorrectionScore).toBeCloseTo(40);
  });

  test('excludes refunded bets and cancelled markets', () => {
    const users = [{ id: 'u1' }];
    const resolvedMarkets = [
      { id: 'm1', resolution: 'YES', status: 'RESOLVED' },
      { id: 'm2', resolution: 'YES', status: 'CANCELLED' }
    ];
    const bets = [
      { userId: 'u1', marketId: 'm1', marketplaceId: null, type: 'BUY', side: 'YES', shares: 20, amount: 4, refunded: true },
      { userId: 'u1', marketId: 'm2', marketplaceId: null, type: 'BUY', side: 'YES', shares: 20, amount: 4 }
    ];

    const rows = calculateWeeklyCorrectionRows({ users, resolvedMarkets, bets });

    expect(rows[0].weeklyResolvedMarkets).toBe(0);
    expect(rows[0].weeklyCorrectionScore).toBe(0);
  });

  test('includes users present only in scored bets', () => {
    const users = [{ id: 'u1' }];
    const resolvedMarkets = [{ id: 'm1', resolution: 'NO', status: 'RESOLVED' }];
    const bets = [{ userId: 'u2', marketId: 'm1', marketplaceId: null, type: 'BUY', side: 'NO', shares: 10, amount: 2 }];

    const rows = calculateWeeklyCorrectionRows({ users, resolvedMarkets, bets });
    const u2 = rows.find((row) => row.id === 'u2');

    expect(u2).toBeTruthy();
    expect(u2.weeklyResolvedMarkets).toBe(1);
    expect(u2.weeklyCorrectionScore).toBeGreaterThan(0);
  });
});
