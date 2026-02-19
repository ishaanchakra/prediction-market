/**
 * Oracle Score utility.
 *
 * Measures prediction accuracy across resolved markets.
 * Rewards correct predictions weighted by conviction (shares held)
 * and how contrarian the user was at entry (bought when crowd disagreed).
 */

/**
 * Calculate a single user's Oracle Score contribution from one resolved market.
 *
 * @param {Object} params
 * @param {Array}  params.userBets  - All bets by this user on this market (not refunded)
 * @param {'YES'|'NO'} params.resolution - How the market resolved
 * @returns {{ contribution: number, sharesOnCorrectSide: number, avgEntryPrice: number } | null}
 *   null if user had no qualifying position on the correct side
 */
export function calculateMarketContribution({ userBets, resolution }) {
  if (!resolution || (resolution !== 'YES' && resolution !== 'NO')) return null;
  if (!Array.isArray(userBets) || userBets.length === 0) return null;

  const winningSide = resolution;

  // BUYs on the winning side (exclude refunded)
  const winningBuys = userBets.filter(
    (bet) => bet.refunded !== true && bet.type !== 'SELL' && bet.side === winningSide
  );

  // SELLs on the winning side (exclude refunded)
  const winningSells = userBets.filter(
    (bet) => bet.refunded !== true && bet.type === 'SELL' && bet.side === winningSide
  );

  const buyShares = winningBuys.reduce((sum, bet) => sum + Math.abs(Number(bet.shares || 0)), 0);
  const sellShares = winningSells.reduce((sum, bet) => sum + Math.abs(Number(bet.shares || 0)), 0);
  const netShares = buyShares - sellShares;

  if (netShares <= 0) return null;

  // Weighted average entry price = sum(price_i * shares_i) / sum(shares_i)
  // where price_i = abs(amount) / shares  (effective cost per share paid)
  let totalWeightedPrice = 0;
  let totalBuyShares = 0;

  for (const bet of winningBuys) {
    const shares = Math.abs(Number(bet.shares || 0));
    const amount = Math.abs(Number(bet.amount || 0));
    if (shares <= 0) continue;
    const entryPrice = amount / shares;
    totalWeightedPrice += entryPrice * shares;
    totalBuyShares += shares;
  }

  if (totalBuyShares === 0) return null;

  const avgEntryPrice = totalWeightedPrice / totalBuyShares;

  // Contrarian bonus: how far from certainty was the market when the user entered?
  // Buying at 20% on a YES that resolves YES = bonus of 0.80. Same formula for NO side.
  const contrarianBonus = 1 - avgEntryPrice;
  if (contrarianBonus <= 0) return null;

  const contribution = netShares * contrarianBonus;

  return {
    contribution,
    sharesOnCorrectSide: netShares,
    avgEntryPrice
  };
}

/**
 * Calculate Oracle Score for a user across multiple resolved markets.
 *
 * @param {Object} params
 * @param {Array}  params.bets        - All bets by this user (refunded bets are skipped internally)
 * @param {Object} params.marketsById - Map of marketId -> market doc (only resolved, non-cancelled)
 * @returns {{ oracleScore: number, marketsScored: number, details: Array }}
 */
export function calculateUserOracleScore({ bets, marketsById }) {
  // Group non-refunded bets by marketId
  const betsByMarket = {};
  for (const bet of bets) {
    if (bet.refunded === true) continue;
    const { marketId } = bet;
    if (!marketId) continue;
    if (!betsByMarket[marketId]) betsByMarket[marketId] = [];
    betsByMarket[marketId].push(bet);
  }

  let oracleScore = 0;
  let marketsScored = 0;
  const details = [];

  for (const [marketId, marketBets] of Object.entries(betsByMarket)) {
    const market = marketsById[marketId];
    if (!market) continue;

    // Only resolved (YES/NO), non-cancelled markets contribute
    const resolution = market.resolution;
    if (resolution !== 'YES' && resolution !== 'NO') continue;
    if (market.status === 'CANCELLED') continue;

    const result = calculateMarketContribution({ userBets: marketBets, resolution });

    if (result && result.contribution > 0) {
      oracleScore += result.contribution;
      marketsScored++;
      details.push({ marketId, ...result });
    }
  }

  return { oracleScore, marketsScored, details };
}
