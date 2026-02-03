import Redis from "ioredis";
import { config } from "../config";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!config.redisUrl) {
    throw new Error("REDIS_URL is not configured");
  }
  if (!client) {
    client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  }
  return client;
}
