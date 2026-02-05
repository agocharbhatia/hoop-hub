import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { parsePbpResponse } from "../src/ingest/pbp";

const payload = JSON.parse(readFileSync("./tests/fixtures/pbp_response.json", "utf8"));

test("parsePbpResponse builds pbp rows and video refs", () => {
  const { rows, videoRefs } = parsePbpResponse(payload, {
    season: "2023-24",
    seasonType: "Regular Season",
    gameId: "0022300001",
  });

  expect(rows.length).toBe(2);
  expect(videoRefs.length).toBe(1);
  const first = rows[0];
  expect(first.shot_zone).toBe("three");
  expect(first.is_clutch).toBe(1);
  expect(first.player_ids).toContain("201939");
});
