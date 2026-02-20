export const ANALYTICS_EVENTS = Object.freeze({
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
  FIRST_BET_PLACED: 'first_bet_placed',
  MARKET_VIEWED: 'market_viewed',
  MARKETPLACE_JOIN_STARTED: 'marketplace_join_started',
  MARKETPLACE_JOIN_COMPLETED: 'marketplace_join_completed',
  LEADERBOARD_MODE_TOGGLED: 'leaderboard_mode_toggled'
});

const MEMORY_KEY = '__predictCornellAnalyticsEvents';

function pushToInMemoryQueue(event) {
  const existing = Array.isArray(window[MEMORY_KEY]) ? window[MEMORY_KEY] : [];
  const next = [...existing, event].slice(-200);
  window[MEMORY_KEY] = next;
}

export function trackEvent(name, payload = {}) {
  if (!name || typeof window === 'undefined') return;

  const event = {
    name,
    payload,
    timestamp: new Date().toISOString()
  };

  pushToInMemoryQueue(event);

  if (Array.isArray(window.dataLayer)) {
    window.dataLayer.push({ event: name, ...payload });
  }

  if (typeof window.gtag === 'function') {
    window.gtag('event', name, payload);
  }

  if (process.env.NODE_ENV !== 'production') {
    // Keep analytics observable during local/dev QA.
    console.debug('[analytics]', event);
  }
}
