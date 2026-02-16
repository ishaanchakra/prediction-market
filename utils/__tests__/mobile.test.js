/**
 * Mobile optimization unit tests for Predict Cornell
 * Tests PWA manifest, viewport config, and touch/input rules
 */

const fs = require('fs');
const path = require('path');

// ─── PWA Manifest ───────────────────────────────────────────────────────────

describe('PWA Manifest', () => {
  let manifest;

  beforeAll(() => {
    const manifestPath = path.resolve(__dirname, '../../public/manifest.json');
    const raw = fs.readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  });

  test('has required name fields', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.short_name.length).toBeLessThanOrEqual(12); // fits home screen label
  });

  test('display is standalone (enables PWA mode)', () => {
    expect(manifest.display).toBe('standalone');
  });

  test('background_color and theme_color match brand dark', () => {
    expect(manifest.background_color).toBe('#080808');
    expect(manifest.theme_color).toBe('#080808');
  });

  test('has at least two icon sizes (192 and 512)', () => {
    const sizes = manifest.icons.map(i => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  test('has a maskable icon for Android adaptive icons', () => {
    const hasMaskable = manifest.icons.some(i => i.purpose && i.purpose.includes('maskable'));
    expect(hasMaskable).toBe(true);
  });

  test('start_url is root', () => {
    expect(manifest.start_url).toBe('/');
  });

  test('orientation is portrait-primary', () => {
    expect(manifest.orientation).toBe('portrait-primary');
  });
});

// ─── Layout HTML (viewport & PWA meta tags) ─────────────────────────────────

describe('Root Layout meta tags', () => {
  let layoutSource;

  beforeAll(() => {
    const layoutPath = path.resolve(__dirname, '../../app/layout.js');
    layoutSource = fs.readFileSync(layoutPath, 'utf8');
  });

  test('viewport includes viewport-fit=cover for notch support', () => {
    expect(layoutSource).toMatch(/viewport-fit=cover/);
  });

  test('viewport includes initial-scale=1', () => {
    expect(layoutSource).toMatch(/initial-scale=1/);
  });

  test('links to PWA manifest', () => {
    expect(layoutSource).toMatch(/manifest\.json/);
  });

  test('sets theme-color meta tag', () => {
    expect(layoutSource).toMatch(/theme-color/);
  });

  test('sets apple-mobile-web-app-capable', () => {
    expect(layoutSource).toMatch(/apple-mobile-web-app-capable/);
  });
});

// ─── Global CSS mobile rules ─────────────────────────────────────────────────

describe('globals.css mobile rules', () => {
  let css;

  beforeAll(() => {
    const cssPath = path.resolve(__dirname, '../../app/globals.css');
    css = fs.readFileSync(cssPath, 'utf8');
  });

  test('defines safe-area-inset CSS variables', () => {
    expect(css).toMatch(/--safe-top/);
    expect(css).toMatch(/--safe-bottom/);
    expect(css).toMatch(/safe-area-inset-top/);
    expect(css).toMatch(/safe-area-inset-bottom/);
  });

  test('sets -webkit-text-size-adjust to prevent font inflation', () => {
    expect(css).toMatch(/-webkit-text-size-adjust:\s*100%/);
  });

  test('applies touch-action: manipulation to interactive elements', () => {
    expect(css).toMatch(/touch-action:\s*manipulation/);
  });

  test('inputs have font-size of at least 16px to prevent iOS zoom', () => {
    // Matches either font-size: 16px or font-size: max(16px, ...)
    expect(css).toMatch(/font-size:\s*(16px|max\(16px)/);
  });

  test('defines minimum touch target size (44px)', () => {
    expect(css).toMatch(/min-height:\s*44px/);
  });
});

// ─── Bet Panel component source checks ───────────────────────────────────────

describe('Bet panel mobile UX (market/[id]/page.js)', () => {
  let source;

  beforeAll(() => {
    const pagePath = path.resolve(__dirname, '../../app/market/[id]/page.js');
    source = fs.readFileSync(pagePath, 'utf8');
  });

  test('amount input has inputmode="numeric"', () => {
    expect(source).toMatch(/input[Mm]ode=["']numeric["']/);
  });

  test('amount input has type="number"', () => {
    expect(source).toMatch(/type=["']number["']/);
  });

  test('bet panel uses sticky positioning on mobile', () => {
    expect(source).toMatch(/sticky/);
  });

  test('chart uses ResponsiveContainer', () => {
    expect(source).toMatch(/ResponsiveContainer/);
  });
});

// ─── Navigation mobile UX ────────────────────────────────────────────────────

describe('Navigation mobile UX (components/Navigation.js)', () => {
  let source;

  beforeAll(() => {
    const navPath = path.resolve(__dirname, '../../app/components/Navigation.js');
    source = fs.readFileSync(navPath, 'utf8');
  });

  test('has mobile menu toggle state', () => {
    // Should have some boolean state for open/close
    expect(source).toMatch(/menuOpen|isOpen|mobileMenu|showMenu/);
  });

  test('uses usePathname to close menu on route change', () => {
    expect(source).toMatch(/usePathname/);
  });

  test('nav accounts for safe-area-inset-top', () => {
    expect(source).toMatch(/safe-top|safe-area-inset-top/);
  });
});

// ─── Toast positioning ────────────────────────────────────────────────────────

describe('ToastStack mobile positioning', () => {
  let source;

  beforeAll(() => {
    const toastPath = path.resolve(__dirname, '../../app/components/ToastStack.js');
    source = fs.readFileSync(toastPath, 'utf8');
  });

  test('positions toasts at bottom on mobile', () => {
    expect(source).toMatch(/bottom/);
  });

  test('accounts for safe-area-inset-bottom', () => {
    expect(source).toMatch(/safe-bottom|safe-area-inset-bottom/);
  });
});
