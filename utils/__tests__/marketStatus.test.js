import { MARKET_STATUS, getMarketStatus, isTradeableMarket } from '../marketStatus';

describe('getMarketStatus', () => {
  // --- existing coverage ---
  test('OPEN market returns OPEN', () => {
    expect(getMarketStatus({ status: MARKET_STATUS.OPEN })).toBe(MARKET_STATUS.OPEN);
  });

  test('LOCKED market returns LOCKED', () => {
    expect(getMarketStatus({ status: MARKET_STATUS.LOCKED })).toBe(MARKET_STATUS.LOCKED);
  });

  test('RESOLVED market returns RESOLVED', () => {
    expect(getMarketStatus({ status: MARKET_STATUS.RESOLVED })).toBe(MARKET_STATUS.RESOLVED);
  });

  test('CANCELLED market returns CANCELLED', () => {
    expect(getMarketStatus({ status: MARKET_STATUS.CANCELLED })).toBe(MARKET_STATUS.CANCELLED);
  });

  test('backward-compat: resolution=YES with no status → RESOLVED', () => {
    expect(getMarketStatus({ resolution: 'YES' })).toBe(MARKET_STATUS.RESOLVED);
  });

  // --- new edge cases ---

  test('null market → OPEN (safe default)', () => {
    expect(getMarketStatus(null)).toBe(MARKET_STATUS.OPEN);
  });

  test('undefined → OPEN (safe default)', () => {
    expect(getMarketStatus(undefined)).toBe(MARKET_STATUS.OPEN);
  });

  test('empty object {} → OPEN (no status, no resolution)', () => {
    expect(getMarketStatus({})).toBe(MARKET_STATUS.OPEN);
  });

  test('resolution=null, no status → OPEN', () => {
    expect(getMarketStatus({ resolution: null })).toBe(MARKET_STATUS.OPEN);
  });

  test('resolution=NO with no status → RESOLVED', () => {
    expect(getMarketStatus({ resolution: 'NO' })).toBe(MARKET_STATUS.RESOLVED);
  });

  test('status takes precedence over resolution field when both present', () => {
    // A market could theoretically have status=LOCKED but resolution still null.
    // Status field always wins when present.
    expect(getMarketStatus({ status: MARKET_STATUS.LOCKED, resolution: null }))
      .toBe(MARKET_STATUS.LOCKED);
  });

  test('status=OPEN with resolution=YES → OPEN (status wins)', () => {
    // Edge: shouldn't happen in prod, but status wins
    expect(getMarketStatus({ status: MARKET_STATUS.OPEN, resolution: 'YES' }))
      .toBe(MARKET_STATUS.OPEN);
  });

  test('status=CANCELLED with resolution=YES → CANCELLED (status wins)', () => {
    expect(getMarketStatus({ status: MARKET_STATUS.CANCELLED, resolution: 'YES' }))
      .toBe(MARKET_STATUS.CANCELLED);
  });

  test('unknown status string passes through as-is', () => {
    // Defensive: unknown statuses shouldn't crash
    expect(getMarketStatus({ status: 'PENDING' })).toBe('PENDING');
  });

  test('extra fields do not affect result', () => {
    expect(getMarketStatus({
      status: MARKET_STATUS.OPEN,
      question: 'Will X happen?',
      probability: 0.72,
      b: 100,
      createdAt: new Date(),
    })).toBe(MARKET_STATUS.OPEN);
  });
});

describe('isTradeableMarket', () => {
  // --- existing coverage ---
  test('OPEN → tradeable', () => {
    expect(isTradeableMarket({ status: MARKET_STATUS.OPEN })).toBe(true);
  });

  test('LOCKED → not tradeable', () => {
    expect(isTradeableMarket({ status: MARKET_STATUS.LOCKED })).toBe(false);
  });

  test('RESOLVED → not tradeable', () => {
    expect(isTradeableMarket({ status: MARKET_STATUS.RESOLVED })).toBe(false);
  });

  test('CANCELLED → not tradeable', () => {
    expect(isTradeableMarket({ status: MARKET_STATUS.CANCELLED })).toBe(false);
  });

  test('backward-compat resolved (no status, resolution set) → not tradeable', () => {
    expect(isTradeableMarket({ resolution: 'YES' })).toBe(false);
  });

  // --- new edge cases ---

  test('null → treated as OPEN → tradeable (note: callers should guard against this)', () => {
    // Documents current behavior — callers should not pass null
    expect(isTradeableMarket(null)).toBe(true);
  });

  test('empty object → OPEN → tradeable', () => {
    expect(isTradeableMarket({})).toBe(true);
  });

  test('resolution=null and no status → OPEN → tradeable', () => {
    expect(isTradeableMarket({ resolution: null, status: undefined })).toBe(true);
  });

  test('only OPEN is tradeable — all other statuses return false', () => {
    const nonTradeable = [
      MARKET_STATUS.LOCKED,
      MARKET_STATUS.RESOLVED,
      MARKET_STATUS.CANCELLED,
      'PENDING',
      'UNKNOWN',
    ];
    for (const status of nonTradeable) {
      expect(isTradeableMarket({ status })).toBe(false);
    }
  });
});