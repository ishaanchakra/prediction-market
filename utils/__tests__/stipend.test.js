const fs = require('fs');
const path = require('path');

function read(relPath) {
  return fs.readFileSync(path.resolve(__dirname, `../../${relPath}`), 'utf8');
}

describe('stipend model - source code checks', () => {
  test('functions/index.js exports injectWeeklyStipend', () => {
    const source = read('functions/index.js');
    expect(source).toContain('injectWeeklyStipend');
    expect(source).toContain('onSchedule');
  });

  test('functions/index.js exports manualStipendInject', () => {
    const source = read('functions/index.js');
    expect(source).toContain('manualStipendInject');
  });

  test('injectWeeklyStipend uses America/New_York timezone', () => {
    const source = read('functions/index.js');
    expect(source).toContain('America/New_York');
  });

  test('injectWeeklyStipend sets weeklyStartingBalance', () => {
    const source = read('functions/index.js');
    expect(source).toContain('weeklyStartingBalance');
  });

  test('injectWeeklyStipend sends stipend notification to users', () => {
    const source = read('functions/index.js');
    expect(source).toContain("type: 'stipend'");
  });

  test('injectWeeklyStipend has idempotency guard using weeklyStipendLastInjectedAt', () => {
    const source = read('functions/index.js');
    expect(source).toContain('weeklyStipendLastInjectedAt');
  });

  test('login page sets weeklyStartingBalance: 1000 for new users', () => {
    const source = read('app/login/page.js');
    expect(source).toContain('weeklyStartingBalance: 1000');
  });

  test('backfill script exists', () => {
    const exists = fs.existsSync(
      path.resolve(__dirname, '../../scripts/backfill-weekly-starting-balance.js')
    );
    expect(exists).toBe(true);
  });

  test('backfill script skips users where weeklyStartingBalance already set', () => {
    const source = read('scripts/backfill-weekly-starting-balance.js');
    expect(source).toContain('weeklyStartingBalance == null');
  });

  test('weekly-reset script does not zero balances', () => {
    const source = read('scripts/weekly-reset.js');
    expect(source).not.toContain('commitResetInChunks');
    expect(source).not.toContain('weeklyRep: WEEKLY_BASELINE');
  });

  test('admin page does not batch-reset weeklyRep to 1000', () => {
    const source = read('app/admin/page.js');
    expect(source).not.toContain("batch.update(doc(db, 'users', d.id), { weeklyRep: 1000 })");
  });

  test('admin page includes manualStipendInject callable', () => {
    const source = read('app/admin/page.js');
    expect(source).toContain('manualStipendInject');
  });
});
