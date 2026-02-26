const fs = require('fs');
const path = require('path');

function read(relPath) {
  return fs.readFileSync(path.resolve(__dirname, `../../${relPath}`), 'utf8');
}

describe('balance baseline constants', () => {
  test('reset script uses weeklyRep 1000 and not 500', () => {
    const source = read('scripts/reset-database.js');
    expect(source).toContain('weeklyRep: round2(1000)');
    expect(source).not.toContain('weeklyRep: round2(500)');
    expect(source).toContain('$1,000');
    expect(source).not.toContain('$500');
  });

  test('login page sets new users weeklyRep to 1000 only', () => {
    const source = read('app/login/page.js');
    expect(source).toContain('weeklyRep: 1000');
    expect(source).not.toContain('weeklyRep: 500');
    expect(source).not.toMatch(/weeklyRep:\s*(?!1000)\d+/);
  });

  test('admin weekly reset does NOT set weeklyRep to 1000 (stipend model)', () => {
    const source = read('app/admin/page.js');
    expect(source).not.toContain("batch.update(doc(db, 'users', d.id), { weeklyRep: 1000 })");
    expect(source).toContain('weeklySnapshots');
  });

  test('leaderboard does not reference hardcoded $1,000 baseline copy', () => {
    const leaderboard = read('app/leaderboard/page.js');
    expect(leaderboard).not.toContain('from a $1,000 baseline');
    const howItWorks = read('app/how-it-works/page.js');
    expect(howItWorks).toContain('$1,000');
    expect(howItWorks).not.toContain('$500');
  });

  test('user profile weeklyNet uses weeklyStartingBalance, not hardcoded 1000', () => {
    const source = read('app/user/[id]/page.js');
    expect(source).toContain('weeklyStartingBalance');
    expect(source).not.toMatch(/weeklyNet\s*=\s*Number\(user\.weeklyRep\s*\|\|\s*0\)\s*-\s*1000/);
  });
});
