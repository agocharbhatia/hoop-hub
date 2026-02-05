import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { parseStatsResponse } from "../src/ingest/stats";

const payload = JSON.parse(readFileSync("./tests/fixtures/stats_response.json", "utf8"));

test("parseStatsResponse builds stats rows + catalog", () => {
  const result = parseStatsResponse("leaguedashplayershotlocations", "2023-24", "Regular Season", {}, payload);
  expect(result.rows.length).toBeGreaterThan(0);

  const statIds = result.rows.map((row) => row.stat_id);
  expect(statIds).toContain("leaguedashplayershotlocations:PTS");
  expect(statIds).toContain("leaguedashplayershotlocations:FG_PCT");

  const mid = result.catalogEntries.find((entry) => entry.statId.endsWith("MID_RANGE_FG_PCT"));
  expect(mid).toBeTruthy();
  expect(mid?.aggregationType).toBe("avg");
});
