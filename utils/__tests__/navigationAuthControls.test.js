const fs = require('fs');
const path = require('path');

function read(relPath) {
  return fs.readFileSync(path.resolve(__dirname, `../../${relPath}`), 'utf8');
}

describe('navigation auth controls', () => {
  test('desktop and mobile auth controls include explicit Log In / Log Out actions', () => {
    const source = read('app/components/Navigation.js');
    expect(source).toContain('Log In');
    expect(source).toContain('Log Out');
    expect(source).toContain("href=\"/login\"");
    expect(source).toContain('onClick={handleLogout}');
  });

  test('signed-out mobile tabs include login tab entry', () => {
    const source = read('app/components/Navigation.js');
    expect(source).toContain("{ href: '/login', icon: 'login', label: 'Login', badge: 0, accent: true }");
  });
});
