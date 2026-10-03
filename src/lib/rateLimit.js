'use strict';

/**
 * Fixed-window, in-memory rate limiter.
 * Good enough for a single instance; use a shared store (Redis) if you scale out.
 */
function createRateLimiter({ now = Date.now } = {}) {
  const hits = new Map(); // key -> { count, resetAt }

  function prune(t) {
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
  }

  return {
    /** @returns {{allowed: boolean, retryAfterSeconds: number}} */
    hit(key, { max, windowMs }) {
      const t = now();
      if (hits.size > 5000) prune(t);
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        entry = { count: 0, resetAt: t + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return {
        allowed: entry.count <= max,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)),
      };
    },
  };
}

module.exports = { createRateLimiter };
