const fs = require('fs');
const path = require('path');

function read(relPath) {
  return fs.readFileSync(path.resolve(__dirname, `../../${relPath}`), 'utf8');
}

describe('leaderboard redesign - source code checks', () => {
  test('leaderboard has three tab ids: weekly, alltime, oracle', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain("'weekly'");
    expect(source).toContain("'alltime'");
    expect(source).toContain("'oracle'");
  });

  test('leaderboard uses activeTab state, not allTimeMode or weeklyMode', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain('activeTab');
    expect(source).not.toContain('allTimeMode');
    expect(source).not.toContain('weeklyMode');
  });

  test('leaderboard does not contain the old correction toggle', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).not.toContain('handleWeeklyModeChange');
    expect(source).not.toContain('weeklyRowsWithModes');
    expect(source).not.toContain("setWeeklyMode('correction')");
  });

  test('all three tabs route to user profile on row click', () => {
    const source = read('app/leaderboard/page.js');
    const matches = source.split('router.push(`/user/').length - 1;
    expect(matches).toBeGreaterThanOrEqual(3);
  });

  test('YouBadge is rendered on all three tab panels', () => {
    const source = read('app/leaderboard/page.js');
    const youBadgeMatches = source.match(/<YouBadge/g);
    expect(youBadgeMatches).not.toBeNull();
    expect(youBadgeMatches.length).toBeGreaterThanOrEqual(3);
  });

  test('oracle tab uses blue accent color', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain('--blue-bright');
  });

  test('blue-bright CSS variable is defined in globals.css', () => {
    const css = read('app/globals.css');
    expect(css).toContain('--blue-bright');
    expect(css).toContain('#60a5fa');
  });

  test('pctReturn helper uses weeklyStartingBalance not hardcoded 1000', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain('weeklyStartingBalance');
    expect(source).not.toContain('weeklyNet || 0) / 1000');
  });

  test('myRankData useMemo handles all three tab cases', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain('myRankData');
    expect(source).toContain("activeTab === 'weekly'");
    expect(source).toContain("activeTab === 'alltime'");
    expect(source).toContain("activeTab === 'oracle'");
  });

  test('past weeks section is preserved', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain('weeklySnapshots');
    expect(source).toContain('PastWeeksSection');
  });

  test('tab bar renders three buttons with dot indicators', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain('This Week');
    expect(source).toContain('All-Time Balance');
    expect(source).toContain('Oracle Score');
  });

  test('empty states exist for all three tabs', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toContain('No trading activity yet this week');
    expect(source).toContain('No all-time data yet');
    expect(source).toContain('No oracle scores yet');
  });

  test('weeklyUsers is sorted by weeklyNet not portfolioValue', () => {
    const source = read('app/leaderboard/page.js');
    expect(source).toMatch(/weeklyUsers[\s\S]{0,200}weeklyNet/);
    expect(source).not.toMatch(/weeklyUsers[\s\S]{0,100}portfolioValue[\s\S]{0,50}sort/);
  });
});
