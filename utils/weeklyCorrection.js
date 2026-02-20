import { calculateMarketContribution } from './oracleScore';
import { round2 } from './round';

export function calculateWeeklyCorrectionRows({ users = [], resolvedMarkets = [], bets = [] }) {
  const validMarkets = resolvedMarkets.filter((market) =>
    (market?.resolution === 'YES' || market?.resolution === 'NO')
    && market?.status !== 'CANCELLED'
  );

  const marketsById = validMarkets.reduce((acc, market) => {
    if (market?.id) {
      acc[market.id] = market;
    }
    return acc;
  }, {});

  const betsByUserMarket = new Map();
  bets.forEach((bet) => {
    if (!bet?.userId || !bet?.marketId) return;
    if (bet.marketplaceId) return;
    if (bet.refunded === true) return;
    if (!marketsById[bet.marketId]) return;

    const key = `${bet.userId}::${bet.marketId}`;
    if (!betsByUserMarket.has(key)) {
      betsByUserMarket.set(key, []);
    }
    betsByUserMarket.get(key).push(bet);
  });

  const scoreByUser = new Map();
  const marketCountByUser = new Map();

  betsByUserMarket.forEach((userBets, key) => {
    const [userId, marketId] = key.split('::');
    const market = marketsById[marketId];
    if (!market) return;

    const result = calculateMarketContribution({
      userBets,
      resolution: market.resolution
    });

    if (!result || result.contribution <= 0) return;

    scoreByUser.set(userId, round2((scoreByUser.get(userId) || 0) + result.contribution));
    marketCountByUser.set(userId, (marketCountByUser.get(userId) || 0) + 1);
  });

  const seenIds = new Set();
  const rows = users.map((user) => {
    seenIds.add(user.id);
    return {
      ...user,
      weeklyCorrectionScore: round2(scoreByUser.get(user.id) || 0),
      weeklyResolvedMarkets: marketCountByUser.get(user.id) || 0
    };
  });

  scoreByUser.forEach((score, userId) => {
    if (seenIds.has(userId)) return;
    rows.push({
      id: userId,
      weeklyCorrectionScore: round2(score),
      weeklyResolvedMarkets: marketCountByUser.get(userId) || 0
    });
  });

  return rows;
}
