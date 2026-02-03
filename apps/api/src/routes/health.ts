import { Hono } from "hono";
import { config } from "../config";
import { clickhouseQuery } from "../db/clickhouse";
import { getPostgres } from "../db/postgres";
import { getRedis } from "../db/redis";

const router = new Hono();

router.get("/", async (c) => {
  const status: Record<string, unknown> = {
    service: "hoophub-api",
    ok: true,
    time: new Date().toISOString(),
  };

  // ClickHouse
  try {
    await clickhouseQuery<{ one: number }>("SELECT 1 AS one");
    status.clickhouse = { ok: true, url: config.clickhouse.url };
  } catch (error) {
    status.ok = false;
    status.clickhouse = { ok: false, error: String(error) };
  }

  // Postgres (optional but expected in prod)
  if (!config.postgresUrl) {
    status.postgres = { ok: false, skipped: true, error: "POSTGRES_URL not set" };
  } else {
    try {
      const sql = getPostgres();
      await sql`select 1 as one`;
      status.postgres = { ok: true };
    } catch (error) {
      status.ok = false;
      status.postgres = { ok: false, error: String(error) };
    }
  }

  // Redis (optional)
  if (!config.redisUrl) {
    status.redis = { ok: true, skipped: true };
  } else {
    try {
      const redis = getRedis();
      const pong = await redis.ping();
      status.redis = { ok: pong === "PONG" };
    } catch (error) {
      status.ok = false;
      status.redis = { ok: false, error: String(error) };
    }
  }

  return c.json(status, status.ok ? 200 : 500);
});

export default router;
