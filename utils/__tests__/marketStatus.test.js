import { MARKET_STATUS, getMarketStatus, isTradeableMarket } from '../marketStatus';

describe('market status helpers', () => {
  test('OPEN to LOCKED to OPEN', () => {
    expect(isTradeableMarket({ status: MARKET_STATUS.OPEN })).toBe(true);
    expect(isTradeableMarket({ status: MARKET_STATUS.LOCKED })).toBe(false);
    expect(isTradeableMarket({ status: MARKET_STATUS.OPEN })).toBe(true);
  });

  test('OPEN/LOCKED to RESOLVED', () => {
    expect(getMarketStatus({ status: MARKET_STATUS.OPEN })).toBe(MARKET_STATUS.OPEN);
    expect(getMarketStatus({ status: MARKET_STATUS.LOCKED })).toBe(MARKET_STATUS.LOCKED);
    expect(getMarketStatus({ status: MARKET_STATUS.RESOLVED })).toBe(MARKET_STATUS.RESOLVED);
    expect(isTradeableMarket({ status: MARKET_STATUS.RESOLVED })).toBe(false);
  });

  test('OPEN/LOCKED to CANCELLED', () => {
    expect(getMarketStatus({ status: MARKET_STATUS.CANCELLED })).toBe(MARKET_STATUS.CANCELLED);
    expect(isTradeableMarket({ status: MARKET_STATUS.CANCELLED })).toBe(false);
  });

  test('backward-compatible resolved markets with no status', () => {
    expect(getMarketStatus({ resolution: 'YES' })).toBe(MARKET_STATUS.RESOLVED);
    expect(isTradeableMarket({ resolution: 'YES' })).toBe(false);
  });
});
