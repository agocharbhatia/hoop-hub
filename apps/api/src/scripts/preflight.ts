import { config } from "../config";
import { clickhouseQuery } from "../db/clickhouse";
import { getPostgres } from "../db/postgres";
import { getRedis } from "../db/redis";
import { archiveRaw } from "../ingest/archive";

function redactUrl(url: string) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username) u.username = "***";
    return u.toString();
  } catch {
    return "<invalid>";
  }
}

async function main() {
  const report: any = {
    time: new Date().toISOString(),
    config: {
      clickhouse: redactUrl(config.clickhouse.url),
      postgres: config.postgresUrl ? redactUrl(config.postgresUrl) : null,
      redis: config.redisUrl ? redactUrl(config.redisUrl) : null,
      s3: {
        endpoint: config.aws.endpoint ?? null,
        rawBucket: config.aws.rawBucket,
        clipBucket: config.aws.clipBucket,
        archiveRaw: config.ingest.archiveRaw,
      },
      llmProvider: config.llmProvider,
      llmBaseUrl: config.llm.baseUrl,
      llmModel: config.llm.model,
    },
    checks: {},
  };

  // ClickHouse
  try {
    await clickhouseQuery<{ one: number }>("SELECT 1 AS one");
    report.checks.clickhouse = { ok: true };
  } catch (e) {
    report.checks.clickhouse = { ok: false, error: String(e) };
  }

  // Postgres
  try {
    const sql = getPostgres();
    await sql`select 1 as one`;
    report.checks.postgres = { ok: true };
  } catch (e) {
    report.checks.postgres = { ok: false, error: String(e) };
  }

  // Redis (optional)
  if (!config.redisUrl) {
    report.checks.redis = { ok: true, skipped: true };
  } else {
    try {
      const redis = getRedis();
      const pong = await redis.ping();
      report.checks.redis = { ok: pong === "PONG" };
    } catch (e) {
      report.checks.redis = { ok: false, error: String(e) };
    }
  }

  // S3/R2 raw write (optional)
  if (!config.ingest.archiveRaw) {
    report.checks.s3_raw_write = { ok: true, skipped: true };
  } else {
    try {
      const key = `preflight/${Date.now()}.json`;
      await archiveRaw(key, { ok: true, time: report.time });
      report.checks.s3_raw_write = { ok: true, key };
    } catch (e) {
      report.checks.s3_raw_write = { ok: false, error: String(e) };
    }
  }

  console.log(JSON.stringify(report, null, 2));

  const failed = Object.values(report.checks).some((c: any) => c && c.ok === false);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("[preflight] failed", e);
  process.exit(1);
});
