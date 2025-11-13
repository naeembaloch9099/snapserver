const redis = require("redis");

// Make Redis optional: if REDIS_URL is not provided we won't attempt to connect.
const REDIS_URL = process.env.REDIS_URL || null;

let client = null;
let connected = false;

if (REDIS_URL) {
  client = redis.createClient({ url: REDIS_URL });

  client.on("error", (err) => {
    console.warn("Redis client error", err && err.message ? err.message : err);
  });

  async function ensureConnected() {
    if (connected) return;
    try {
      await client.connect();
      connected = true;
    } catch (e) {
      console.warn(
        "Failed to connect to Redis:",
        e && e.message ? e.message : e
      );
    }
  }

  // expose ensureConnected for tests or manual control
  module.exports.ensureConnected = ensureConnected;
}

async function getCached(key, fn, ttl = 300) {
  // If no Redis configured, just return fresh value from fn
  if (!client) {
    return await fn();
  }

  try {
    if (!connected) await module.exports.ensureConnected();
    if (connected) {
      const cached = await client.get(key);
      if (cached) return JSON.parse(cached);
    }
  } catch (e) {
    console.warn("Redis read error for", key, e && e.message ? e.message : e);
  }

  // Fallback to fetching fresh data
  const fresh = await fn();
  try {
    if (connected) await client.setEx(key, ttl, JSON.stringify(fresh));
  } catch (e) {
    console.warn("Redis set error for", key, e && e.message ? e.message : e);
  }
  return fresh;
}

module.exports = { getCached, client };
