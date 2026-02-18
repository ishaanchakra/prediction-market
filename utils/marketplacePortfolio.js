import { round2 } from './round';
import { calculatePortfolioValue } from './portfolio';

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export { chunkArray };

export function calculateMarketplacePortfolioRows({
  members = [],
  bets = [],
  openMarkets = [],
  startingBalance = 500
}) {
  const openMarketsById = Object.fromEntries(openMarkets.map((market) => [market.id, market]));
  const betsByUser = new Map();

  bets.forEach((bet) => {
    if (!bet?.userId) return;
    if (!betsByUser.has(bet.userId)) betsByUser.set(bet.userId, []);
    betsByUser.get(bet.userId).push(bet);
  });

  return members.map((member) => {
    const result = calculatePortfolioValue({
      cashBalance: Number(member.balance || 0),
      userBets: betsByUser.get(member.userId) || [],
      openMarketsById
    });

    return {
      ...member,
      cashBalance: round2(result.cashBalance),
      positionsValue: round2(result.positionsValue),
      portfolioValue: round2(result.portfolioValue),
      weeklyNet: round2(result.portfolioValue - Number(startingBalance || 0))
    };
  });
}

