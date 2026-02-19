export function getMarketplaceInviteIdentifier(marketplace) {
  if (!marketplace || typeof marketplace !== 'object') return null;

  const slug = typeof marketplace.slug === 'string' ? marketplace.slug.trim() : '';
  if (slug) return slug;

  const id = typeof marketplace.id === 'string' ? marketplace.id.trim() : '';
  if (id) return id;

  return null;
}

export function buildMarketplaceInviteUrl(origin, marketplace) {
  if (typeof origin !== 'string' || !origin.trim()) return null;

  const identifier = getMarketplaceInviteIdentifier(marketplace);
  if (!identifier) return null;

  return `${origin}/marketplace/enter?marketplace=${encodeURIComponent(identifier)}`;
}
