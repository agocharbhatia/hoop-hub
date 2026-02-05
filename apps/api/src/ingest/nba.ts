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

export function parseStatsUrl(url: string) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const endpoint = parts[parts.length - 1] ?? "";
  const params: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return { endpoint, params };
}

function formatSidecarError(status: number, detail: unknown, fallback: string, endpoint: string) {
  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    const type = String(record.error_type ?? "nba_error");
    const message = String(record.message ?? fallback);
    const retryable = record.retryable === true ? "retryable" : "non_retryable";
    return `NBA sidecar error ${status} for ${endpoint}: ${type}:${retryable}:${message}`;
  }
  return `NBA sidecar error ${status} for ${endpoint}: ${fallback}`;
}

export async function nbaFetch(url: string, options: FetchOptions = {}) {
  const retries = options.retries ?? config.ingest.maxRetries;
  let attempt = 0;
  let lastError: Error | null = null;
  const sidecarUrl = config.ingest.sidecarUrl?.trim();
  const proxyUrl = config.ingest.proxyUrl?.trim();
  const useSidecar = sidecarUrl && url.startsWith(NBA_STATS_BASE);

  while (attempt <= retries) {
    try {
      if (useSidecar) {
        const { endpoint, params } = parseStatsUrl(url);
        const response = await fetch(`${sidecarUrl.replace(/\/$/, "")}/stats`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint,
            params,
            timeout_ms: config.ingest.fetchTimeoutMs,
            proxy: proxyUrl || undefined,
          }),
        });

        const text = await response.text();
        let parsed: any = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }

        if (!response.ok) {
          const detail = parsed?.detail;
          throw new Error(formatSidecarError(response.status, detail, text, endpoint));
        }

        const payload = parsed?.payload ?? parsed;
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.ingest.fetchTimeoutMs);

      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          ...nbaHeaders(),
          ...(options.headers ?? {}),
        },
        body: options.body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = response.headers.get("retry-after");
        const delay = retryAfter ? Number(retryAfter) * 1000 : config.ingest.retryBaseMs * (attempt + 1);
        await sleep(delay);
        attempt++;
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`NBA fetch error ${response.status} for ${url}: ${body}`);
      }

      return response;
    } catch (error) {
      lastError = error as Error;
      const delay = config.ingest.retryBaseMs * (attempt + 1);
      await sleep(delay);
      attempt++;
    }
  }

  throw lastError ?? new Error(`NBA fetch failed for ${url}`);
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
