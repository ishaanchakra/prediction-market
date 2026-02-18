import { round2 } from './round';

export const MARKETPLACE_ROLE = {
  CREATOR: 'CREATOR',
  MEMBER: 'MEMBER'
};

export const MARKETPLACE_RESET_MODE = {
  WEEKLY: 'WEEKLY',
  MANUAL: 'MANUAL'
};

export const MARKETPLACE_DEFAULTS = {
  startingBalance: 500,
  defaultB: 50,
  resetMode: MARKETPLACE_RESET_MODE.WEEKLY
};

export function toMarketplaceMemberId(marketplaceId, userId) {
  return `${marketplaceId}_${userId}`;
}

export function slugifyMarketplaceName(name = '') {
  const slug = String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'marketplace';
}

export function nextWeeklyResetDate(from = new Date()) {
  const next = new Date(from);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay();
  const daysUntilMonday = (8 - (day || 7)) % 7 || 7;
  next.setDate(next.getDate() + daysUntilMonday);
  return next;
}

export function mondayIso(date = new Date()) {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizeMarketplaceBalance(value, fallback = MARKETPLACE_DEFAULTS.startingBalance) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? round2(n) : round2(fallback);
}

