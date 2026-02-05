import { afterEach, expect, test } from "bun:test";
import { clickhouseInsert } from "../src/db/clickhouse";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("clickhouseInsert sends rows in configured chunks", async () => {
  const bodies: string[] = [];

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return new Response("", { status: 200 });
  }) as typeof fetch;

  const rows = Array.from({ length: 5001 }, (_, idx) => ({ idx }));
  await clickhouseInsert("stats_fact", rows);

  expect(bodies.length).toBe(3);
  expect(bodies[0].split("\n").length).toBe(2000);
  expect(bodies[1].split("\n").length).toBe(2000);
  expect(bodies[2].split("\n").length).toBe(1001);
});

test("clickhouseInsert splits failing chunk on memory limit exceeded", async () => {
  const chunkSizes: number[] = [];
  let call = 0;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    const size = body ? body.split("\n").length : 0;
    chunkSizes.push(size);
    call += 1;

    if (call === 1) {
      return new Response("Code: 241. DB::Exception: MEMORY_LIMIT_EXCEEDED", { status: 500 });
    }
    return new Response("", { status: 200 });
  }) as typeof fetch;

  const rows = Array.from({ length: 4 }, (_, idx) => ({ idx }));
  await clickhouseInsert("stats_fact", rows);

  expect(chunkSizes).toEqual([4, 2, 2]);
});

