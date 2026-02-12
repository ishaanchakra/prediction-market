export function normalizeDisplayName(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isValidDisplayName(name) {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 3 || trimmed.length > 24) return false;
  return /^[A-Za-z0-9 _-]+$/.test(trimmed);
}

export function getPublicDisplayName(user) {
  if (user?.displayName && user.displayName.trim()) return user.displayName.trim();
  if (user?.id) return `Trader ${user.id.slice(0, 4)}`;
  return 'Trader';
}
