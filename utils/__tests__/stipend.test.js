const fs = require('fs');
const path = require('path');

function read(relPath) {
  return fs.readFileSync(path.resolve(__dirname, `../../${relPath}`), 'utf8');
}

describe('stipend model - source code checks', () => {
  test('functions/index.js exports distributeStipend', () => {
    const source = read('functions/index.js');
    expect(source).toContain('distributeStipend');
  });

  test('distributeStipend uses ISO week idempotency guard', () => {
    const source = read('functions/index.js');
    expect(source).toContain('lastStipendWeek');
    expect(source).toContain('getISOWeek');
  });

  test('distributeStipend sends stipend notification to users', () => {
    const source = read('functions/index.js');
    expect(source).toContain("type: 'stipend'");
  });

  test('login page sets totalDeposits: 1000 for new users', () => {
    const source = read('app/login/page.js');
    expect(source).toContain('totalDeposits: 1000');
  });

  test('login page sets accountCreatedAt for new users', () => {
    const source = read('app/login/page.js');
    expect(source).toContain('accountCreatedAt:');
  });

  test('weekly-reset script does not zero balances', () => {
    const source = read('scripts/weekly-reset.js');
    expect(source).not.toContain('commitResetInChunks');
    expect(source).not.toContain('balance: WEEKLY_BASELINE');
  });

  test('admin page does not batch-reset balance to 1000', () => {
    const source = read('app/admin/page.js');
    expect(source).not.toContain("batch.update(doc(db, 'users', d.id), { balance: 1000 })");
  });

  test('admin page includes distributeStipend callable', () => {
    const source = read('app/admin/page.js');
    expect(source).toContain('distributeStipend');
  });

  test('migration script exists', () => {
    const exists = fs.existsSync(
      path.resolve(__dirname, '../../scripts/migrate-to-cumulative-balance.js')
    );
    expect(exists).toBe(true);
  });
});
