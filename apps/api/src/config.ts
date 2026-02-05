import "dotenv/config";

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  llmProvider: env.LLM_PROVIDER ?? "mock",
  llmApiKey: env.LLM_API_KEY ?? "",
  llm: {
    // Default OpenAI base URL for the Responses API.
    baseUrl: env.LLM_BASE_URL ?? "https://api.openai.com/v1",
    model: env.LLM_MODEL ?? "gpt-5-mini",
    // Keep this low for cost and latency; bump for gnarly queries.
    reasoningEffort: (env.LLM_REASONING_EFFORT ?? "low") as "minimal" | "low" | "medium" | "high",
  },
  clickhouse: {
    url: env.CLICKHOUSE_URL ?? "http://localhost:8123",
    user: env.CLICKHOUSE_USER ?? "default",
    password: env.CLICKHOUSE_PASSWORD ?? "",
  },
  postgresUrl: env.POSTGRES_URL ?? "",
  redisUrl: env.REDIS_URL ?? "",
  aws: {
    region: env.AWS_REGION ?? "us-east-1",
    rawBucket: env.S3_RAW_BUCKET ?? "hoophub-raw",
    clipBucket: env.S3_CLIP_BUCKET ?? "hoophub-clips",
    clipUrlTtlSeconds: Number(env.CLIP_URL_TTL_SECONDS ?? 86400),
    // For Cloudflare R2 or other S3-compatible stores, set S3_ENDPOINT (e.g. https://<accountid>.r2.cloudflarestorage.com)
    endpoint: env.S3_ENDPOINT,
  },
  limits: {
    maxClipCount: Number(env.MAX_CLIP_COUNT ?? 40),
    maxClipSeconds: Number(env.MAX_CLIP_SECONDS ?? 600),
  },
  ingest: {
    seasonStart: Number(env.INGEST_SEASON_START ?? 1946),
    backfillBatch: Number(env.INGEST_BACKFILL_BATCH ?? 2),
    rateLimitMs: Number(env.INGEST_RATE_LIMIT_MS ?? 450),
    maxRetries: Number(env.INGEST_MAX_RETRIES ?? 5),
    retryBaseMs: Number(env.INGEST_RETRY_BASE_MS ?? 600),
    archiveRaw: env.INGEST_ARCHIVE_RAW?.toLowerCase() !== "false",
  },
};
