export const NOTIFICATION_CATEGORY = Object.freeze({
  MARKET_MOVED: 'MARKET_MOVED',
  MARKET_RESOLVED: 'MARKET_RESOLVED',
  RANK_CHANGED: 'RANK_CHANGED',
  MARKETPLACE_INVITE: 'MARKETPLACE_INVITE'
});

export function categoryForNotificationType(type) {
  if (type === 'payout' || type === 'loss' || type === 'refund') {
    return NOTIFICATION_CATEGORY.MARKET_RESOLVED;
  }
  if (type === 'significant_trade') {
    return NOTIFICATION_CATEGORY.MARKET_MOVED;
  }
  if (type === 'admin_adjustment') {
    return NOTIFICATION_CATEGORY.RANK_CHANGED;
  }
  if (type === 'stipend') {
    return NOTIFICATION_CATEGORY.RANK_CHANGED;
  }
  if (type === 'rank_change') {
    return NOTIFICATION_CATEGORY.RANK_CHANGED;
  }
  if (type === 'marketplace_invite') {
    return NOTIFICATION_CATEGORY.MARKETPLACE_INVITE;
  }
  return NOTIFICATION_CATEGORY.MARKET_MOVED;
}
