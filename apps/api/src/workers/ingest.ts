import { config } from "../config";

async function ingestStats() {
  console.log("[ingest] TODO: fetch NBA.com stats endpoints and normalize.");
}

async function ingestPbp() {
  console.log("[ingest] TODO: fetch play-by-play and video refs.");
}

async function run() {
  console.log("[ingest] starting", { clickhouse: config.clickhouse.url });
  await ingestStats();
  await ingestPbp();
  console.log("[ingest] complete");
}

run().catch((error) => {
  console.error("[ingest] failed", error);
  process.exit(1);
});
