import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../config";
import { getPostgres } from "../db/postgres";
import { clickhouseQuery } from "../db/clickhouse";

async function runPostgresSchema() {
  if (!config.postgresUrl) {
    console.log("[bootstrap] skipping Postgres (POSTGRES_URL not set)");
    return;
  }
  const sql = getPostgres();
  const schemaPath = resolve(import.meta.dir, "../../../infra/schema/postgres.sql");
  const schema = await readFile(schemaPath, "utf8");
  await sql.unsafe(schema);
  console.log("[bootstrap] applied Postgres schema");
}

async function runClickHouseSchema() {
  const schemaPath = resolve(import.meta.dir, "../../../infra/schema/clickhouse.sql");
  const schema = await readFile(schemaPath, "utf8");

  // ClickHouse HTTP interface accepts a single statement; split on semicolons.
  const statements = schema
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await clickhouseQuery(`${stmt};`);
  }
  console.log("[bootstrap] applied ClickHouse schema");
}

async function main() {
  await runClickHouseSchema();
  await runPostgresSchema();
}

main().catch((err) => {
  console.error("[bootstrap] failed", err);
  process.exit(1);
});
