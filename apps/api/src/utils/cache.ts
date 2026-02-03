import { config } from "../config";
import { getRedis } from "../db/redis";

type CacheValue = { value: unknown; expiresAt: number };
const memoryCache = new Map<string, CacheValue>();

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (config.redisUrl) {
    try {
      const redis = getRedis();
      const raw = await redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      // fall back to memory cache
    }
  }

  const cached = memoryCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return cached.value as T;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 60) {
  if (config.redisUrl) {
    try {
      const redis = getRedis();
      await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
      return;
    } catch {
      // fall back to memory cache
    }
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}
