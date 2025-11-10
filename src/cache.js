const redis = require("redis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const client = redis.createClient({ url: REDIS_URL });

client.on("error", (err) => {
  console.warn("Redis client error", err && err.message ? err.message : err);
});

let connected = false;
async function ensureConnected() {
  if (connected) return;
  try {
    await client.connect();
    connected = true;
  } catch (e) {
    console.warn("Failed to connect to Redis:", e && e.message ? e.message : e);
  }
}

async function getCached(key, fn, ttl = 300) {
  try {
    await ensureConnected();
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
