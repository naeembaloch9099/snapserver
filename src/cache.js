// Redis removed: caching now falls back to always returning fresh data.
// This file intentionally does not require the `redis` package so the
// server can run without Redis being installed or configured.

async function getCached(key, fn, ttl = 300) {
  // No caching backend configured: always return fresh result.
  // We keep the same signature as before so callers don't need to change.
  return await fn();
}

module.exports = { getCached };
