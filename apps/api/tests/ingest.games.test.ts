import { test, expect, afterAll, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { fetchSeasonGames } from "../src/ingest/games";
import { nbaFetch } from "../src/ingest/nba";

// Mock nbaFetch for this test.
const payload = JSON.parse(readFileSync("./tests/fixtures/gamefinder_response.json", "utf8"));

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

test("fetchSeasonGames de-dupes game ids", async () => {
  const rows = await fetchSeasonGames("2023-24", "Regular Season");
  expect(rows.length).toBe(1);
  expect(rows[0]?.game_id).toBe("0022300001");
});
