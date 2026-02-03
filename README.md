# Hoop Hub — NBA NL Stats + Video Query Engine (Bun + Svelte)

This repo contains a Bun backend and Svelte frontend for a natural‑language NBA stats + video query engine.

## Structure
- `apps/api` Bun API + workers
- `apps/web` Svelte frontend (Vite)
- `infra/schema` SQL schemas for Postgres + ClickHouse

## Quick start
### API
```bash
cd apps/api
bun install
bun run dev
```

### Web
```bash
cd apps/web
bun install
bun run dev
```

## Environment variables
API (`apps/api/.env`):
- `PORT=8787`
- `LLM_PROVIDER=openai|anthropic|mock`
- `LLM_API_KEY=...`
- `CLICKHOUSE_URL=http://localhost:8123`
- `CLICKHOUSE_USER=default`
- `CLICKHOUSE_PASSWORD=`
- `POSTGRES_URL=postgres://...`
- `REDIS_URL=redis://localhost:6379`
- `AWS_REGION=us-east-1`
- `S3_RAW_BUCKET=hoophub-raw`
- `S3_CLIP_BUCKET=hoophub-clips`
- `CLIP_URL_TTL_SECONDS=86400`

Web (`apps/web/.env`):
- `VITE_API_BASE=http://localhost:8787`

## Notes
- This is a functional skeleton with clear extension points for ingestion, cataloging, and clip compilation.
- NBA.com endpoint ingestion and full stat coverage should be implemented in `apps/api/src/workers/ingest.ts`.

## Legal
This project is not affiliated with the NBA. Video clips are fetched from NBA.com and compiled on‑demand without permanent hosting.
