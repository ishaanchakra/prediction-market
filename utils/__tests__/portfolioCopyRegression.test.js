const fs = require('fs');
const path = require('path');

function read(relPath) {
  return fs.readFileSync(path.resolve(__dirname, `../../${relPath}`), 'utf8');
}

describe('cumulative wallet copy regressions', () => {
  test('portfolio overview uses netPnl key and cumulative label copy', () => {
    const source = read('app/components/PortfolioView.js');
    expect(source).toContain('summary.netPnl');
    expect(source).not.toContain('summary.weeklyPnl');
    expect(source).toContain('Net P&L');
    expect(source).toContain('portfolio value minus total deposits');
  });

  test('profile pages use live-balance wording and avoid weekly stipend language', () => {
    const ownProfile = read('app/profile/page.js');
    const publicProfile = read('app/user/[id]/page.js');

    expect(ownProfile).toContain('Live cash balance');
    expect(publicProfile).toContain('Live cash balance');
    expect(ownProfile.toLowerCase()).not.toContain('weekly stipend');
    expect(publicProfile.toLowerCase()).not.toContain('weekly stipend');
  });
});
