const fs = require('fs');
const path = require('path');

function read(relPath) {
  return fs.readFileSync(path.resolve(__dirname, `../../${relPath}`), 'utf8');
}

describe('market interaction guards', () => {
  test('bet submit button requires a strictly positive numeric amount', () => {
    const source = read('app/market/[id]/page.js');
    expect(source).toContain('const isBetAmountValid = Number.isFinite(betAmountNumber) && betAmountNumber > 0;');
    expect(source).toContain('disabled={!currentUser || !isBetAmountValid || submitting || !isTradeableMarket(market)}');
  });

  test('bet amount input uses decimal step for cash entry', () => {
    const source = read('app/market/[id]/page.js');
    expect(source).toContain('step="0.01"');
  });
});
