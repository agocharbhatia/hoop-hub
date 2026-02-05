# Hoop Hub — NBA NL Stats + Video Query Engine (Bun + Svelte)

This repo contains a Bun backend and Svelte frontend for a natural‑language NBA stats + video query engine.

## Structure
- `apps/api` Bun API + workers
- `apps/web` Svelte frontend (Vite)
- `infra/schema` SQL schemas for Postgres + ClickHouse

## Quick start
### Local services (recommended for dev)
```bash
docker compose up -d
```

### API
```bash
cd apps/api
bun install
bun run bootstrap
bun run dev
```

### Preflight (validates DBs + R2/S3)
```bash
cd apps/api
bun run preflight
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
- `LLM_PROVIDER=openai|mock`
- `LLM_API_KEY=...`
- `LLM_BASE_URL=https://api.openai.com/v1`
- `LLM_MODEL=gpt-5-mini`
- `LLM_REASONING_EFFORT=low`
- `CLICKHOUSE_URL=http://localhost:8123`
- `CLICKHOUSE_USER=default`
- `CLICKHOUSE_PASSWORD=`
- `POSTGRES_URL=postgres://...`
- `REDIS_URL=redis://localhost:6379`
- `AWS_REGION=us-east-1`
- `AWS_ACCESS_KEY_ID=...`
- `AWS_SECRET_ACCESS_KEY=...`
- `S3_RAW_BUCKET=hoophub-raw`
- `S3_CLIP_BUCKET=hoophub-clips`
- `S3_ENDPOINT=` (optional, for S3-compatible stores like Cloudflare R2)
- `CLIP_URL_TTL_SECONDS=86400`

Tunnel profile override (`apps/api/.env.tunnel`):
- copy from `apps/api/.env.tunnel.example`
- set only overrides, for example:
  - `CLICKHOUSE_URL=http://127.0.0.1:18123`
  - `INGEST_SIDECAR_URL=http://127.0.0.1:8008`
- `INGEST_SIDECAR_URL=` (optional, e.g. http://127.0.0.1:8008 to use the Python sidecar)
- `INGEST_PROXY_URL=` (optional, proxy URL forwarded to the sidecar)

Web (`apps/web/.env`):
- `VITE_API_BASE=http://localhost:8787`

## ClickHouse on DigitalOcean + API on Fly.io (recommended cheap setup)
If you want ClickHouse on a DigitalOcean droplet but keep your Bun API on Fly.io, the safest setup is
to **avoid exposing ClickHouse publicly** and instead connect via an **SSH local port-forward** from Fly.

1. Create a DO ClickHouse 1‑Click droplet (example IP: `167.71.191.168`).
2. Keep ClickHouse's HTTP port (`8123`) private (bind to localhost and/or block via firewall).
3. Deploy the API to Fly using the Dockerfile + tunnel entrypoint:
   - `apps/api/Dockerfile`
   - `apps/api/scripts/start-with-tunnel.sh`
   - `apps/api/fly.toml.example` (copy to `apps/api/fly.toml` and set your app name)
4. Set Fly secrets:
```bash
fly secrets set \\
  DO_CLICKHOUSE_HOST=167.71.191.168 \\
  DO_CLICKHOUSE_SSH_USER=root \\
  DO_SSH_PRIVATE_KEY=\"$(cat ~/.ssh/id_ed25519)\" \\
  CLICKHOUSE_USER=default \\
  CLICKHOUSE_PASSWORD=\"<your-clickhouse-password>\"
```

Optional (recommended): pin host key to avoid MITM. From your machine:
```bash
ssh-keyscan -H 167.71.191.168
```
Then set it as `DO_SSH_KNOWN_HOSTS` in Fly secrets.

Once deployed, your API will talk to ClickHouse through `http://127.0.0.1:18123` inside the Fly machine.

## Notes
- This is a functional skeleton with clear extension points for ingestion, cataloging, and clip compilation.
- NBA.com endpoint ingestion and full stat coverage should be implemented in `apps/api/src/workers/ingest.ts`.

## Ingestion (DO ClickHouse droplet)
Run the ingestion worker on your ClickHouse droplet (best performance) or locally for tests.

```bash
cd apps/api
bun run worker:ingest
```

Local tunnel mode (no repeated exports):
```bash
cd apps/api
bun run ingest:status:tunnel
bun run worker:ingest:tunnel
```

If an endpoint gets stuck retrying, unstick it:
```bash
cd apps/api
bun run ingest:unstick
```

Optional flags:
- `--dry-run` preview affected tasks without changing anything.
- `--endpoint <name>` target a different `season_stats_endpoint`.
- `--all` mark all pending/retry/running tasks as failed.

## Ingestion via Python sidecar (local)
If `stats.nba.com` is blocked from your server IP, run ingestion locally with the Python sidecar
(`apps/ingest-python`) and point the Bun worker at it.

```bash
# Terminal 1: start the sidecar
cd apps/ingest-python
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8008

# Terminal 2: run ingestion locally (pointing at sidecar)
cd apps/api
INGEST_SIDECAR_URL=http://127.0.0.1:8008 bun run worker:ingest
```

## Tests
```bash
cd apps/api
bun test
```

Integration tests (opt-in, hit real services):
```bash
cd apps/api
INTEGRATION_TESTS=1 bun test
```

Env vars for ingestion:
- `INGEST_SEASON_START=1946`
- `INGEST_BACKFILL_BATCH=2`
- `INGEST_RATE_LIMIT_MS=450`
- `INGEST_MAX_RETRIES=5`
- `INGEST_RETRY_BASE_MS=600`
- `INGEST_FETCH_TIMEOUT_MS=15000`
- `INGEST_IDLE_LOG_MS=30000`
- `INGEST_ARCHIVE_RAW=true`
- `INGEST_MAX_TASK_ATTEMPTS=8`
- `INGEST_MAX_RETRY_DELAY_MS=600000`

## Legal
This project is not affiliated with the NBA. Video clips are fetched from NBA.com and compiled on‑demand without permanent hosting.
