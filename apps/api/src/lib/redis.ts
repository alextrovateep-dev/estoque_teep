import Redis from "ioredis";

const url = process.env.REDIS_URL || "redis://localhost:6379";

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (process.env.REDIS_DISABLED === "1") return null;
  if (!redis) {
    try {
      redis = new Redis(url, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      redis.on("error", () => {
        /* swallow reconnect noise in dev without redis */
      });
    } catch {
      return null;
    }
  }
  return redis;
}

export async function ensureRedis(): Promise<Redis | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    if (client.status !== "ready") {
      await client.connect();
    }
    await client.ping();
    return client;
  } catch {
    return null;
  }
}
