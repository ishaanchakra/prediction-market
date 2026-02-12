export const MARKET_STATUS = {
  OPEN: 'OPEN',
  LOCKED: 'LOCKED',
  RESOLVED: 'RESOLVED',
  CANCELLED: 'CANCELLED'
};

export function getMarketStatus(market) {
  if (!market) return MARKET_STATUS.OPEN;
  if (market.status) return market.status;
  if (market.resolution) return MARKET_STATUS.RESOLVED;
  return MARKET_STATUS.OPEN;
}

export function isTradeableMarket(market) {
  const status = getMarketStatus(market);
  return status === MARKET_STATUS.OPEN;
}
