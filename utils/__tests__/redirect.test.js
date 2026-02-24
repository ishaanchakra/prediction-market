import { buildLoginPath, sanitizeInternalRedirectPath } from '../redirect';

describe('sanitizeInternalRedirectPath', () => {
  test('returns fallback for empty values', () => {
    expect(sanitizeInternalRedirectPath('')).toBe('/');
    expect(sanitizeInternalRedirectPath(null)).toBe('/');
    expect(sanitizeInternalRedirectPath(undefined)).toBe('/');
  });

  test('returns fallback for non-internal values', () => {
    expect(sanitizeInternalRedirectPath('https://example.com/evil')).toBe('/');
    expect(sanitizeInternalRedirectPath('dashboard')).toBe('/');
    expect(sanitizeInternalRedirectPath('//evil.com')).toBe('/');
  });

  test('returns internal path as-is', () => {
    expect(sanitizeInternalRedirectPath('/marketplace/enter?marketplace=abc')).toBe('/marketplace/enter?marketplace=abc');
    expect(sanitizeInternalRedirectPath('/onboarding?next=%2Fmarketplace%2Fenter')).toBe('/onboarding?next=%2Fmarketplace%2Fenter');
  });
});

describe('buildLoginPath', () => {
  test('returns bare login for root next path', () => {
    expect(buildLoginPath('/')).toBe('/login');
  });

  test('adds encoded next path for internal destination', () => {
    expect(buildLoginPath('/marketplace/enter?marketplace=cornell-2026'))
      .toBe('/login?next=%2Fmarketplace%2Fenter%3Fmarketplace%3Dcornell-2026');
  });
});
