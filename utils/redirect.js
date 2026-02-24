export function sanitizeInternalRedirectPath(path, fallback = '/') {
  const fallbackPath = typeof fallback === 'string' && fallback.startsWith('/') ? fallback : '/';
  const rawPath = typeof path === 'string' ? path.trim() : '';
  if (!rawPath) return fallbackPath;
  if (!rawPath.startsWith('/')) return fallbackPath;
  if (rawPath.startsWith('//')) return fallbackPath;
  return rawPath;
}

export function buildLoginPath(nextPath) {
  const safeNext = sanitizeInternalRedirectPath(nextPath, '/');
  if (safeNext === '/') return '/login';
  return `/login?next=${encodeURIComponent(safeNext)}`;
}
