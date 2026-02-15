import { normalizeDisplayName, isValidDisplayName, getPublicDisplayName } from '../displayName';

// ─── normalizeDisplayName ────────────────────────────────────────────────────

describe('normalizeDisplayName', () => {
  // --- existing coverage ---
  test('normalizes case and whitespace', () => {
    expect(normalizeDisplayName('  Alex   Kim  ')).toBe('alex kim');
  });

  // --- new edge cases ---

  test('leading whitespace trimmed', () => {
    expect(normalizeDisplayName('   hello')).toBe('hello');
  });

  test('trailing whitespace trimmed', () => {
    expect(normalizeDisplayName('hello   ')).toBe('hello');
  });

  test('multiple internal spaces collapsed to one', () => {
    expect(normalizeDisplayName('big   brained   trader')).toBe('big brained trader');
  });

  test('tabs treated as whitespace and collapsed', () => {
    expect(normalizeDisplayName('hello\tworld')).toBe('hello world');
  });

  test('already normalized string is unchanged', () => {
    expect(normalizeDisplayName('alex kim')).toBe('alex kim');
  });

  test('uppercase letters are lowercased', () => {
    expect(normalizeDisplayName('ORACLE_99')).toBe('oracle_99');
  });

  test('mixed case + spaces normalized together', () => {
    expect(normalizeDisplayName('  Big Brain  ')).toBe('big brain');
  });

  test('single character is preserved (normalization does not enforce length)', () => {
    expect(normalizeDisplayName('A')).toBe('a');
  });

  test('empty string stays empty', () => {
    expect(normalizeDisplayName('')).toBe('');
  });

  test('only spaces becomes empty string', () => {
    expect(normalizeDisplayName('   ')).toBe('');
  });

  test('hyphens and underscores are preserved', () => {
    expect(normalizeDisplayName('trader_one-x')).toBe('trader_one-x');
  });

  test('numbers are preserved', () => {
    expect(normalizeDisplayName('Trader99')).toBe('trader99');
  });
});

// ─── isValidDisplayName ──────────────────────────────────────────────────────

describe('isValidDisplayName', () => {
  // --- existing coverage ---
  test('valid: typical name with space', () => {
    expect(isValidDisplayName('Alex Kim')).toBe(true);
  });

  test('invalid: too short (1 char)', () => {
    expect(isValidDisplayName('a')).toBe(false);
  });

  test('invalid: too long (>24 chars)', () => {
    expect(isValidDisplayName('This Name Is Far Too Long To Allow')).toBe(false);
  });

  test('invalid: special char @', () => {
    expect(isValidDisplayName('Alex@Kim')).toBe(false);
  });

  // --- boundary cases ---

  test('valid: exactly 3 characters (lower boundary)', () => {
    expect(isValidDisplayName('abc')).toBe(true);
  });

  test('invalid: exactly 2 characters (below boundary)', () => {
    expect(isValidDisplayName('ab')).toBe(false);
  });

  test('valid: exactly 24 characters (upper boundary)', () => {
    expect(isValidDisplayName('a'.repeat(24))).toBe(true);
  });

  test('invalid: exactly 25 characters (above boundary)', () => {
    expect(isValidDisplayName('a'.repeat(25))).toBe(false);
  });

  // --- allowed characters ---

  test('valid: numbers only', () => {
    expect(isValidDisplayName('123')).toBe(true);
  });

  test('valid: underscore allowed', () => {
    expect(isValidDisplayName('my_name')).toBe(true);
  });

  test('valid: hyphen allowed', () => {
    expect(isValidDisplayName('my-name')).toBe(true);
  });

  test('valid: mixed letters, numbers, space, underscore, hyphen', () => {
    expect(isValidDisplayName('Trader_99-x')).toBe(true);
  });

  // --- disallowed characters ---

  test('invalid: period', () => {
    expect(isValidDisplayName('alex.kim')).toBe(false);
  });

  test('invalid: exclamation mark', () => {
    expect(isValidDisplayName('oracle!')).toBe(false);
  });

  test('invalid: emoji', () => {
    expect(isValidDisplayName('oracle🔮')).toBe(false);
  });

  test('invalid: forward slash', () => {
    expect(isValidDisplayName('a/b/c')).toBe(false);
  });

  test('invalid: parentheses', () => {
    expect(isValidDisplayName('(oracle)')).toBe(false);
  });

  // --- whitespace edge cases ---

  test('valid: name with single internal space', () => {
    expect(isValidDisplayName('big brain')).toBe(true);
  });

  test('invalid: empty string', () => {
    expect(isValidDisplayName('')).toBe(false);
  });

  test('invalid: only spaces (trims to empty)', () => {
    expect(isValidDisplayName('   ')).toBe(false);
  });

  test('leading/trailing spaces are trimmed before length check', () => {
    // '  ab  ' trims to 'ab' which is 2 chars → invalid
    expect(isValidDisplayName('  ab  ')).toBe(false);
    // '  abc  ' trims to 'abc' → valid
    expect(isValidDisplayName('  abc  ')).toBe(true);
  });

  test('multiple internal spaces collapsed before charset check', () => {
    // 'a  b' after collapse is 'a b' — space is in allowed set
    expect(isValidDisplayName('a  b')).toBe(true);
  });
});

// ─── getPublicDisplayName ────────────────────────────────────────────────────

describe('getPublicDisplayName', () => {
  // --- existing coverage ---
  test('falls back to Trader + first 4 chars of id when no displayName', () => {
    expect(getPublicDisplayName({ id: 'abcd1234' })).toBe('Trader abcd');
  });

  // --- new edge cases ---

  test('returns displayName when set', () => {
    expect(getPublicDisplayName({ id: 'uid1', displayName: 'BigBrain' }))
      .toBe('BigBrain');
  });

  test('trims whitespace from displayName', () => {
    expect(getPublicDisplayName({ id: 'uid1', displayName: '  Oracle  ' }))
      .toBe('Oracle');
  });

  test('empty displayName string falls through to id fallback', () => {
    expect(getPublicDisplayName({ id: 'abcd1234', displayName: '' }))
      .toBe('Trader abcd');
  });

  test('whitespace-only displayName falls through to id fallback', () => {
    expect(getPublicDisplayName({ id: 'abcd1234', displayName: '   ' }))
      .toBe('Trader abcd');
  });

  test('null displayName falls through to id fallback', () => {
    expect(getPublicDisplayName({ id: 'abcd1234', displayName: null }))
      .toBe('Trader abcd');
  });

  test('undefined displayName falls through to id fallback', () => {
    expect(getPublicDisplayName({ id: 'abcd1234', displayName: undefined }))
      .toBe('Trader abcd');
  });

  test('no id and no displayName → "Trader"', () => {
    expect(getPublicDisplayName({})).toBe('Trader');
  });

  test('null user → "Trader"', () => {
    expect(getPublicDisplayName(null)).toBe('Trader');
  });

  test('undefined user → "Trader"', () => {
    expect(getPublicDisplayName(undefined)).toBe('Trader');
  });

  test('id shorter than 4 chars is sliced safely', () => {
    // slice(0,4) on a 2-char string returns the whole string — no throw
    expect(getPublicDisplayName({ id: 'ab' })).toBe('Trader ab');
  });

  test('id longer than 4 chars is sliced to first 4', () => {
    expect(getPublicDisplayName({ id: 'abcdefgh' })).toBe('Trader abcd');
  });

  test('displayName wins over id even when both present', () => {
    expect(getPublicDisplayName({ id: 'xyz9', displayName: 'Oracle' }))
      .toBe('Oracle');
  });

  test('displayName with leading spaces is trimmed correctly', () => {
    const result = getPublicDisplayName({ id: 'uid1', displayName: '  CornellOracle' });
    expect(result).toBe('CornellOracle');
  });
});