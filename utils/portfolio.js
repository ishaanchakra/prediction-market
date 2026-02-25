import { MARKET_STATUS, getMarketStatus } from './marketStatus';
import { round2 } from './round';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, toNumber(value, 0.5)));
}

function cleanSmall(value) {
  return Math.abs(value) < 0.001 ? 0 : value;
}

function formatResolvedDate(bet) {
  const dateValue = bet?.marketResolvedAt || bet?.marketCancelledAt || bet?.marketResolutionDate;
  const date = dateValue?.toDate?.() || (dateValue instanceof Date ? dateValue : null);
  return date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
}

function inferStatusFromBet(bet) {
  if (bet?.marketStatus) return bet.marketStatus;
  return getMarketStatus({
    status: bet?.status,
    resolution: bet?.marketResolution,
    resolvedAt: bet?.marketResolvedAt,
    cancelledAt: bet?.marketCancelledAt
  });
}

export function aggregatePositions(bets = []) {
  const byMarket = new Map();

  for (const bet of bets) {
    const marketId = bet?.marketId;
    if (!marketId) continue;

    if (!byMarket.has(marketId)) {
      byMarket.set(marketId, {
        marketId,
        marketQuestion: bet?.marketQuestion || 'Unknown market',
        marketStatus: inferStatusFromBet(bet),
        marketProbability: clamp01(bet?.marketProbability),
        marketResolution: bet?.marketResolution || null,
        marketCategory: bet?.marketCategory || 'wildcard',
        resolvedDate: formatResolvedDate(bet),
        yesShares: 0,
        noShares: 0,
        yesCost: 0,
        noCost: 0
      });
    }

    const entry = byMarket.get(marketId);
    const side = bet?.side === 'NO' ? 'NO' : 'YES';
    const type = bet?.type === 'SELL' ? 'SELL' : 'BUY';
    const shares = Math.abs(toNumber(bet?.shares, 0));
    const amount = Math.abs(toNumber(bet?.amount, 0));

    if (side === 'YES') {
      entry.yesShares += type === 'BUY' ? shares : -shares;
      entry.yesCost += type === 'BUY' ? amount : -amount;
    } else {
      entry.noShares += type === 'BUY' ? shares : -shares;
      entry.noCost += type === 'BUY' ? amount : -amount;
    }

    if (!entry.resolvedDate) {
      entry.resolvedDate = formatResolvedDate(bet);
    }
  }

  const positions = [];

  for (const entry of byMarket.values()) {
    const yesShares = Math.max(0, cleanSmall(round2(entry.yesShares)));
    const noShares = Math.max(0, cleanSmall(round2(entry.noShares)));
    if (yesShares <= 0 && noShares <= 0) continue;

    const yesCost = Math.max(0, cleanSmall(round2(entry.yesCost)));
    const noCost = Math.max(0, cleanSmall(round2(entry.noCost)));
    const totalCost = round2(yesCost + noCost);

    const status = entry.marketStatus;
    const probability = clamp01(entry.marketProbability);

    let marketValue;
    if ([MARKET_STATUS.OPEN, MARKET_STATUS.LOCKED].includes(status)) {
      marketValue = round2((yesShares * probability) + (noShares * (1 - probability)));
    } else if (status === MARKET_STATUS.RESOLVED) {
      const winPayout = entry.marketResolution === 'YES' ? yesShares : entry.marketResolution === 'NO' ? noShares : 0;
      marketValue = round2(Math.max(0, winPayout));
    } else if (status === MARKET_STATUS.CANCELLED) {
      marketValue = round2(totalCost);
    } else {
      marketValue = round2((yesShares * probability) + (noShares * (1 - probability)));
    }

    const unrealizedPnl = round2(marketValue - totalCost);
    const unrealizedPnlPct = totalCost > 0 ? round2((unrealizedPnl / totalCost) * 100) : 0;

    let side = 'MIXED';
    if (yesShares > 0 && noShares <= 0) side = 'YES';
    if (noShares > 0 && yesShares <= 0) side = 'NO';
    if (yesShares > 0 && noShares > 0) {
      side = yesShares === noShares ? 'MIXED' : (yesShares > noShares ? 'YES' : 'NO');
    }

    positions.push({
      marketId: entry.marketId,
      marketQuestion: entry.marketQuestion,
      marketStatus: status,
      marketProbability: probability,
      marketResolution: entry.marketResolution,
      marketCategory: entry.marketCategory || 'wildcard',
      resolvedDate: entry.resolvedDate,
      yesShares,
      noShares,
      yesCost,
      noCost,
      side,
      totalCost,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct
    });
  }

  return positions;
}

export function calculatePortfolioSummary(user = {}, positions = []) {
  const cashBalance = round2(toNumber(user?.weeklyRep, 0));
  const activePositions = positions.filter((pos) => [MARKET_STATUS.OPEN, MARKET_STATUS.LOCKED].includes(pos.marketStatus));

  const yesExposure = round2(activePositions.reduce(
    (sum, pos) => sum + (pos.yesShares * clamp01(pos.marketProbability)),
    0
  ));
  const noExposure = round2(activePositions.reduce(
    (sum, pos) => sum + (pos.noShares * (1 - clamp01(pos.marketProbability))),
    0
  ));

  const positionsValue = round2(activePositions.reduce((sum, pos) => sum + toNumber(pos.marketValue, 0), 0));
  const portfolioValue = round2(cashBalance + positionsValue);
  const weeklyPnl = round2(portfolioValue - 1000);
  const marketCount = activePositions.length;

  const base = portfolioValue > 0 ? portfolioValue : 1;
  const cashPct = round2((cashBalance / base) * 100);
  const yesPct = round2((yesExposure / base) * 100);
  const noPct = round2((noExposure / base) * 100);

  return {
    cashBalance,
    positionsValue,
    portfolioValue,
    weeklyPnl,
    yesExposure,
    noExposure,
    marketCount,
    cashPct,
    yesPct,
    noPct
  };
}

export function calculatePortfolioValue({ cashBalance, userBets = [], openMarketsById = {} }) {
  const normalizedBets = userBets.map((bet) => {
    const market = openMarketsById[bet.marketId] || {};
    return {
      ...bet,
      marketQuestion: market.question || bet.marketQuestion,
      marketStatus: MARKET_STATUS.OPEN,
      marketProbability: clamp01(market.probability),
      marketResolution: null,
      marketCategory: market.category || 'wildcard'
    };
  });

  const positions = aggregatePositions(normalizedBets);
  const summary = calculatePortfolioSummary({ weeklyRep: cashBalance }, positions);

  const positionsByMarket = {};
  for (const pos of positions) {
    positionsByMarket[pos.marketId] = {
      yesShares: pos.yesShares,
      noShares: pos.noShares
    };
  }

  return {
    cashBalance: summary.cashBalance,
    positionsValue: summary.positionsValue,
    portfolioValue: summary.portfolioValue,
    netProfit: summary.weeklyPnl,
    positionsByMarket
  };
}

export function calculateAllPortfolioValues({ users = [], bets = [], openMarkets = [] }) {
  const openMarketsById = Object.fromEntries(openMarkets.map((market) => [market.id, market]));
  const betsByUserId = new Map();

  for (const bet of bets) {
    if (!bet?.userId) continue;
    if (!betsByUserId.has(bet.userId)) betsByUserId.set(bet.userId, []);
    betsByUserId.get(bet.userId).push(bet);
  }

  return users.map((user) => {
    const userId = user.id || user.uid;
    const result = calculatePortfolioValue({
      cashBalance: user.weeklyRep,
      userBets: betsByUserId.get(userId) || [],
      openMarketsById
    });

    return {
      ...user,
      id: userId,
      cashBalance: result.cashBalance,
      positionsValue: result.positionsValue,
      portfolioValue: result.portfolioValue,
      weeklyNet: result.netProfit
    };
  });
}
