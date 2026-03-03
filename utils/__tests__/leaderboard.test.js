const fs = require('fs');
const path = require('path');

function read(relPath) {
  return fs.readFileSync(path.resolve(__dirname, `../../${relPath}`), 'utf8');
}

describe('leaderboard source checks', () => {
  test('uses two tab ids: oracle and netpnl', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain("id: 'oracle'");
    expect(source).toContain("id: 'netpnl'");
    expect(source).not.toContain("id: 'weekly'");
    expect(source).not.toContain("id: 'alltime'");
  });

  test('uses activeTab state and does not use legacy weekly/all-time mode flags', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain('activeTab');
    expect(source).not.toContain('allTimeMode');
    expect(source).not.toContain('weeklyMode');
    expect(source).not.toContain('handleWeeklyModeChange');
  });

  test('net pnl explanation references cumulative deposits model', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain('minus total deposits');
    expect(source).toContain('Net P&L = (Cash + Open Positions at current price) − Total Deposits');
  });

  test('global-scope query filters are present for markets and bets', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain("where('marketplaceId', '==', null)");
    expect(source).toContain("collection(db, 'bets')");
    expect(source).toContain("collection(db, 'markets')");
  });

  test('rows in both tabs route to user profile pages', () => {
    const source = read('app/leaderboard/page.js');
    const matches = source.split('router.push(`/user/').length - 1;
    expect(matches).toBeGreaterThanOrEqual(2);
  });

  test('you badge is rendered in at least rank card + tab rows', () => {
    const source = read('app/leaderboard/page.js');
    const youBadgeMatches = source.match(/<YouBadge/g);
    expect(youBadgeMatches).not.toBeNull();
    expect(youBadgeMatches.length).toBeGreaterThanOrEqual(3);
  });

  test('snapshot archive section remains available', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain('PastWeeksSection');
    expect(source).toContain('weeklySnapshots');
    expect(source).toContain('Snapshot Archive');
  });

  test('empty states exist for both leaderboard tabs', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain('No trading activity yet.');
    expect(source).toContain('No oracle scores yet. Scores appear after markets resolve.');
  });

  test('pctReturn helper uses totalDeposits rather than hardcoded baseline', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain('totalDeposits');
    expect(source).not.toContain('netPnl || 0) / 1000');
  });

  test('no weekly reset copy remains in leaderboard header', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain('updates continuously');
    expect(source).not.toContain('resets Sunday');
  });
});
