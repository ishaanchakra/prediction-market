import { buildMarketplaceInviteUrl, getMarketplaceInviteIdentifier } from '../marketplaceInvite';

describe('getMarketplaceInviteIdentifier', () => {
  test('uses slug when available', () => {
    expect(getMarketplaceInviteIdentifier({ id: 'abc123', slug: 'cornell-2026' })).toBe('cornell-2026');
  });

  test('falls back to id when slug is missing', () => {
    expect(getMarketplaceInviteIdentifier({ id: 'abc123' })).toBe('abc123');
  });

  test('trims slug and id values', () => {
    expect(getMarketplaceInviteIdentifier({ id: '  abc123  ', slug: '  cornell-2026  ' })).toBe('cornell-2026');
    expect(getMarketplaceInviteIdentifier({ id: '  abc123  ', slug: '   ' })).toBe('abc123');
  });

  test('returns null when no usable slug or id exists', () => {
    expect(getMarketplaceInviteIdentifier({ slug: '   ', id: '   ' })).toBeNull();
    expect(getMarketplaceInviteIdentifier(null)).toBeNull();
  });
});

describe('buildMarketplaceInviteUrl', () => {
  test('builds invite url with slug', () => {
    expect(buildMarketplaceInviteUrl('https://predictcornell.com', { id: 'abc123', slug: 'cornell-2026' }))
      .toBe('https://predictcornell.com/marketplace/enter?marketplace=cornell-2026');
  });

  test('falls back to id when slug is unavailable', () => {
    expect(buildMarketplaceInviteUrl('https://predictcornell.com', { id: 'market_42', slug: '' }))
      .toBe('https://predictcornell.com/marketplace/enter?marketplace=market_42');
  });

  test('url-encodes identifier', () => {
    expect(buildMarketplaceInviteUrl('https://predictcornell.com', { id: 'abc123', slug: 'space slug/2026' }))
      .toBe('https://predictcornell.com/marketplace/enter?marketplace=space%20slug%2F2026');
  });

  test('returns null when origin is missing or identifier is missing', () => {
    expect(buildMarketplaceInviteUrl('', { id: 'abc123' })).toBeNull();
    expect(buildMarketplaceInviteUrl('https://predictcornell.com', { id: '   ', slug: '   ' })).toBeNull();
  });
});
