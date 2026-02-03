import { config } from "../config";

type CacheValue = { value: unknown; expiresAt: number };
const memoryCache = new Map<string, CacheValue>();

export async function cacheGet<T>(key: string): Promise<T | null> {
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
    // TODO: replace with Redis client when configured.
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}
