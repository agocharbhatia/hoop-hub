import { config } from "../config";
import { sleep } from "./utils";

export const NBA_STATS_BASE = "https://stats.nba.com/stats";
export const NBA_PBP_BASE = "https://cdn.nba.com/static/json/liveData/playbyplay";

export function nbaHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    Referer: "https://www.nba.com/",
    Origin: "https://www.nba.com",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Connection: "keep-alive",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
  };
}

type FetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  retries?: number;
};

export async function nbaFetch(url: string, options: FetchOptions = {}) {
  const retries = options.retries ?? config.ingest.maxRetries;
  let attempt = 0;
  let lastError: Error | null = null;
  while (attempt <= retries) {
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          ...nbaHeaders(),
          ...(options.headers ?? {}),
        },
        body: options.body,
      });

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = response.headers.get("retry-after");
        const delay = retryAfter ? Number(retryAfter) * 1000 : config.ingest.retryBaseMs * (attempt + 1);
        await sleep(delay);
        attempt++;
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`NBA fetch error ${response.status}: ${text}`);
      }

      return response;
    } catch (error) {
      lastError = error as Error;
      const delay = config.ingest.retryBaseMs * (attempt + 1);
      await sleep(delay);
      attempt++;
    }
  }

  throw lastError ?? new Error("NBA fetch failed");
}

export function buildStatsUrl(endpoint: string, params: Record<string, string | number | undefined>) {
  const url = new URL(`${NBA_STATS_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function buildPbpUrl(gameId: string) {
  return `${NBA_PBP_BASE}/playbyplay_${gameId}.json`;
}
