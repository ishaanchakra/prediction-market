const fs = require('fs');
const path = require('path');

function read(relPath) {
  return fs.readFileSync(path.resolve(__dirname, `../../${relPath}`), 'utf8');
}

describe('notifications redesign + significant trade gate - source code checks', () => {
  test('notifications page uses card system components', () => {
    const source = read('app/notifications/page.js');
    expect(source).toContain('NotificationCard');
    expect(source).toContain('SectionLabel');
    expect(source).toContain('getCardConfig');
    expect(source).toContain('ProbMoveStrip');
  });

  test('notifications page includes redesigned unread/read sections', () => {
    const source = read('app/notifications/page.js');
    expect(source).toContain('Unread');
    expect(source).toContain('Read');
    expect(source).toContain('Mark all read');
  });

  test('notifications page uses 400-sized chunking for mark all read updates', () => {
    const source = read('app/notifications/page.js');
    expect(source).toContain('i += 400');
    expect(source).toContain('writeBatch(db)');
  });

  test('notifications page does not use forbidden utility colors', () => {
    const source = read('app/notifications/page.js');
    expect(source).not.toContain('text-green-600');
    expect(source).not.toContain('text-red-600');
    expect(source).not.toContain('text-blue-700');
    expect(source).not.toContain('border-brand-pink');
    expect(source).not.toContain('border-brand-red');
  });

  test('significant_trade card uses userSide and probability fields without trader identity', () => {
    const source = read('app/notifications/page.js');
    expect(source).toContain("if (type === 'significant_trade')");
    expect(source).toContain('oldProbability');
    expect(source).toContain('newProbability');
    expect(source).toContain('probabilityChange');
    expect(source).toContain('userSide');
    expect(source).not.toContain('traderNetid');
  });

  test('placeBet defines significant-trade constants and gating', () => {
    const source = read('functions/index.js');
    expect(source).toContain('SIGNIFICANT_TRADE_MIN_TRADES = 5');
    expect(source).toContain('SIGNIFICANT_TRADE_MIN_PROB_CHANGE = 0.05');
    expect(source).toContain('Math.abs(probabilityChange) >= SIGNIFICANT_TRADE_MIN_PROB_CHANGE');
    expect(source).toContain('tradeCount < SIGNIFICANT_TRADE_MIN_TRADES');
  });

  test('placeBet significant-trade payload includes expected fields', () => {
    const source = read('functions/index.js');
    expect(source).toContain("type: 'significant_trade'");
    expect(source).toContain("category: 'MARKET_MOVED'");
    expect(source).toContain('tradeSide: side');
    expect(source).toContain('oldProbability');
    expect(source).toContain('newProbability');
    expect(source).toContain('probabilityChange');
    expect(source).toContain('userSide');
    expect(source).toContain('tradeCount');
    expect(source).not.toContain('traderNetid');
  });

  test('placeBet significant-trade query is marketplace-scoped', () => {
    const source = read('functions/index.js');
    expect(source).toContain("where('marketId', '==', marketId)");
    expect(source).toContain("where('marketplaceId', '==', (txResult.marketplaceId ?? null))");
  });

  test('notification categories maps stipend to rank-changed bucket', () => {
    const source = read('utils/notificationCategories.js');
    expect(source).toContain("if (type === 'stipend')");
    expect(source).toContain('return NOTIFICATION_CATEGORY.RANK_CHANGED');
  });
});
