// Simple in-memory cache with TTL
// This replaces Redis for local/dev usage. It stores values in a Map
// with an expiry timestamp. It's not shared between processes and
// will be cleared when the server restarts.

const cache = new Map();

function _now() {
  return Date.now();
}

/**
 * getCached(key, fn, ttlSeconds)
 * - key: string key for the cached entry
 * - fn: async function to produce the fresh value when missing/expired
 * - ttlSeconds: number of seconds that value is valid in cache (default 300)
 *
 * Returns the cached value if present and not expired, otherwise calls fn()
 * to obtain a fresh value, stores it with expiry, and returns it.
 */
async function getCached(key, fn, ttlSeconds = 300) {
  try {
    const entry = cache.get(key);
    if (entry) {
      if (entry.expiresAt > _now()) {
        return entry.value;
      }
      // expired
      cache.delete(key);
    }

    const fresh = await fn();
    try {
      cache.set(key, {
        value: fresh,
        expiresAt: _now() + Math.max(0, Number(ttlSeconds)) * 1000,
      });
    } catch (e) {
      // Ignore cache set errors — still return fresh
      console.warn("cache set error", e && e.message ? e.message : e);
    }

    return fresh;
  } catch (e) {
    // If the producer function fails, bubble the error to caller
    throw e;
  }
}

function del(key) {
  return cache.delete(key);
}

function clear() {
  cache.clear();
}

function stats() {
  return { keys: cache.size };
}

module.exports = { getCached, del, clear, stats };
