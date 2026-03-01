function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') {
    const nanos = Number(value.nanoseconds || 0);
    return (value.seconds * 1000) + Math.floor(nanos / 1e6);
  }
  const parsed = new Date(value);
  const ts = parsed.getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

function getBetSortTime(bet) {
  return toMillis(bet?.createdAt || bet?.timestamp);
}

function normalizeType(value) {
  return value === 'SELL' ? 'SELL' : 'BUY';
}

function normalizeSide(value) {
  return value === 'NO' ? 'NO' : 'YES';
}

function outcomeFromResolution(resolution) {
  if (resolution === 'YES') return 1;
  if (resolution === 'NO') return 0;
  return null;
}

function toDisplayOracleScore(rawBrierAvg) {
  const rescaled = ((rawBrierAvg - 0.75) / 0.25) * 100;
  if (rescaled < 0) return 0;
  if (rescaled > 100) return 100;
  return rescaled;
}

/**
 * Calculate contribution from a single market.
 *
 * @param {Object} params
 * @param {Array} params.userBets
 * @param {'YES'|'NO'} params.resolution
 * @returns {{ brierScore: number, impliedProbability: number, lastActionType: string } | null}
 */
export function calculateMarketContribution({ userBets, resolution }) {
  const outcome = outcomeFromResolution(resolution);
  if (outcome == null) return null;
  if (!Array.isArray(userBets) || userBets.length === 0) return null;

  const nonRefunded = userBets.filter((bet) => bet && bet.refunded !== true);
  if (nonRefunded.length === 0) return null;

  const sorted = [...nonRefunded].sort((a, b) => getBetSortTime(b) - getBetSortTime(a));
  const lastAction = sorted[0];
  if (!lastAction) return null;

  // Only score users who held a net position at resolution (fully exited positions don't count).
  let netYesShares = 0;
  let netNoShares = 0;
  for (const bet of nonRefunded) {
    const betType = normalizeType(bet.type);
    const betSide = normalizeSide(bet.side);
    const shares = Math.abs(Number(bet.shares || 0));
    if (betSide === 'YES') {
      netYesShares += betType === 'BUY' ? shares : -shares;
    } else {
      netNoShares += betType === 'BUY' ? shares : -shares;
    }
  }
  if (Math.max(0, netYesShares) <= 0.001 && Math.max(0, netNoShares) <= 0.001) return null;

  const side = normalizeSide(lastAction.side);
  const type = normalizeType(lastAction.type);
  const impliedProbability = clamp01(lastAction.marketProbabilityAtBet ?? lastAction.probability);
  if (impliedProbability == null) return null;

  const error = outcome - impliedProbability;
  const brierScore = 1 - (error * error);

  return {
    brierScore,
    impliedProbability,
    lastActionType: `${type}_${side}`
  };
}

/**
 * Calculate full Oracle Score across markets.
 *
 * @param {Object} params
 * @param {Array} params.bets
 * @param {Object} params.marketsById
 * @returns {{ oracleScore: number, rawBrierAvg: number, marketsScored: number, details: Array }}
 */
export function calculateUserOracleScore({ bets, marketsById }) {
  if (!Array.isArray(bets) || bets.length === 0) {
    return { oracleScore: 0, rawBrierAvg: 0, marketsScored: 0, details: [] };
  }

  const betsByMarket = {};
  for (const bet of bets) {
    if (!bet?.marketId) continue;
    if (!betsByMarket[bet.marketId]) betsByMarket[bet.marketId] = [];
    betsByMarket[bet.marketId].push(bet);
  }

  let rawBrierSum = 0;
  let marketsScored = 0;
  const details = [];

  for (const [marketId, userBets] of Object.entries(betsByMarket)) {
    const market = marketsById?.[marketId];
    if (!market) continue;
    if (market.status === 'CANCELLED') continue;

    const resolution = market.resolution;
    const contribution = calculateMarketContribution({ userBets, resolution });
    if (!contribution) continue;

    rawBrierSum += contribution.brierScore;
    marketsScored += 1;
    details.push({
      marketId,
      brierScore: contribution.brierScore,
      impliedProbability: contribution.impliedProbability,
      resolution,
      lastActionType: contribution.lastActionType
    });
  }

  if (marketsScored === 0) {
    return { oracleScore: 0, rawBrierAvg: 0, marketsScored: 0, details: [] };
  }

  const rawBrierAvg = rawBrierSum / marketsScored;
  const oracleScore = toDisplayOracleScore(rawBrierAvg);
  return { oracleScore, rawBrierAvg, marketsScored, details };
}
