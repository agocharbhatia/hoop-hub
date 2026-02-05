import { test, expect } from "bun:test";
import { seasonLabelFromYear, guessShotZone, parseScoreMargin, extractUuid } from "../src/ingest/utils";
import { parseStatsUrl } from "../src/ingest/nba";

test("seasonLabelFromYear formats correctly", () => {
  expect(seasonLabelFromYear(2023)).toBe("2023-24");
});

test("guessShotZone categorizes by distance", () => {
  expect(guessShotZone(3, "")).toBe("rim");
  expect(guessShotZone(10, "")).toBe("paint");
  expect(guessShotZone(18, "")).toBe("mid-range");
  expect(guessShotZone(24, "3PT Field Goal")).toBe("three");
});

test("parseScoreMargin handles strings", () => {
  expect(parseScoreMargin("+5")).toBe(5);
  expect(parseScoreMargin("-3")).toBe(-3);
  expect(parseScoreMargin("TIE")).toBe(0);
});

test("extractUuid finds nested UUID", () => {
  const uuid = extractUuid({ a: { b: "123e4567-e89b-12d3-a456-426614174000" } });
  expect(uuid).toBe("123e4567-e89b-12d3-a456-426614174000");
});

test("parseStatsUrl extracts endpoint + params", () => {
  const { endpoint, params } = parseStatsUrl(
    "https://stats.nba.com/stats/leaguedashplayerstats?Season=2024-25&SeasonType=Regular%20Season&PerMode=PerGame"
  );
  expect(endpoint).toBe("leaguedashplayerstats");
  expect(params.Season).toBe("2024-25");
  expect(params.SeasonType).toBe("Regular Season");
  expect(params.PerMode).toBe("PerGame");
});
