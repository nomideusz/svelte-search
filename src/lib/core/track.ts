// ============================================================
// @nomideusz/svelte-search — Search event tracker
// ============================================================
// Lightweight fire-and-forget search analytics.
// No PII — sessionId is a random UUID in sessionStorage.

import type { TrackSearchEvent } from './types.js';

export interface TrackerConfig {
  /** API endpoint to POST events to (default: '/api/search-events') */
  endpoint?: string;
  /** sessionStorage key (default: 'search_sid') */
  sessionKey?: string;
}

export function createTracker(config: TrackerConfig = {}) {
  const endpoint = config.endpoint ?? '/api/search-events';
  const sessionKey = config.sessionKey ?? 'search_sid';

  function getSessionId(): string {
    if (typeof sessionStorage === 'undefined') return '';
    let sid = sessionStorage.getItem(sessionKey);
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem(sessionKey, sid);
    }
    return sid;
  }

  function track(event: TrackSearchEvent): void {
    try {
      const body = { ...event, sessionId: getSessionId() };
      const payload = JSON.stringify(body);
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' }));
      } else if (typeof fetch !== 'undefined') {
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Never fail the user experience for tracking
    }
  }

  return { track };
}
