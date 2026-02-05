import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { parseStatsResponse } from "../src/ingest/stats";

const payload = JSON.parse(readFileSync("./tests/fixtures/stats_response.json", "utf8"));

test("parseStatsResponse builds stats rows + catalog", () => {
  const result = parseStatsResponse(
    "leaguedashplayershotlocations",
    "leaguedashplayershotlocations",
    "2023-24",
    "Regular Season",
    { PerMode: "PerGame", MeasureType: "Base" },
    payload,
    { variantId: "base_per_game" }
  );

  expect(result.rows.length).toBeGreaterThan(0);

  const statIds = result.rows.map((row) => row.stat_id);
  expect(statIds).toContain("leaguedashplayershotlocations:PTS");
  expect(statIds).toContain("leaguedashplayershotlocations:FG_PCT");

  const sample = result.rows[0];
  expect(sample.source_module).toBe("leaguedashplayershotlocations");
  expect(sample.dataset_name).toBe("LeagueDashPlayerStats");
  expect(sample.metric_key.length).toBeGreaterThan(0);
  expect(sample.is_rank_metric).toBe(0);

  const mid = result.catalogEntries.find((entry) => entry.statId.endsWith("MID_RANGE_FG_PCT"));
  expect(mid).toBeTruthy();
  expect(mid?.aggregationType).toBe("avg");
});

test("parseStatsResponse excludes ID and rank columns from metrics", () => {
  const synthetic = {
    resultSets: [
      {
        name: "Synthetic",
        headers: ["PLAYER_ID", "PLAYER_NAME", "PTS", "PTS_RANK"],
        rowSet: [[201939, "Stephen Curry", 28.5, 3]],
      },
    ],
  };

  const result = parseStatsResponse(
    "leaguedashplayerstats",
    "leaguedashplayerstats",
    "2024-25",
    "Regular Season",
    {},
    synthetic,
    { variantId: "measure_base_per_game" }
  );

  expect(result.rows.find((row) => row.metric_key === "PLAYER_ID")).toBeUndefined();
  expect(result.rows.find((row) => row.metric_key === "PTS")).toBeTruthy();
  expect(result.rows.find((row) => row.metric_key === "PTS_RANK")).toBeUndefined();

  const rankCatalog = result.catalogEntries.find((entry) => entry.statId.endsWith("PTS_RANK"));
  expect(rankCatalog).toBeUndefined();
});
