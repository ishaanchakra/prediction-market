import { normalizeDisplayName, isValidDisplayName, getPublicDisplayName } from '../displayName';

describe('display name helpers', () => {
  test('normalizes case and whitespace', () => {
    expect(normalizeDisplayName('  Alex   Kim  ')).toBe('alex kim');
  });

  test('validates allowed charset and length', () => {
    expect(isValidDisplayName('Alex Kim')).toBe(true);
    expect(isValidDisplayName('a')).toBe(false);
    expect(isValidDisplayName('This Name Is Far Too Long To Allow')).toBe(false);
    expect(isValidDisplayName('Alex@Kim')).toBe(false);
  });

  test('public fallback hides email', () => {
    expect(getPublicDisplayName({ id: 'abcd1234' })).toBe('Trader abcd');
  });
});
