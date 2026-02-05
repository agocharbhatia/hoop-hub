# NBA API Sidecar (Python)

This service wraps the `nba_api` package and exposes a simple HTTP endpoint for stats.nba.com calls.
It is designed to run locally and be called by the Bun ingestion worker.

## Setup
```bash
cd apps/ingest-python
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

## Run
```bash
. .venv/bin/activate
uvicorn app:app --host 127.0.0.1 --port 8008
```

Health check:
```bash
curl http://127.0.0.1:8008/health
```

## Configure Bun ingestion to use the sidecar
In `apps/api/.env` (local dev):
```
INGEST_SIDECAR_URL=http://127.0.0.1:8008
```

Then run the worker locally:
```bash
cd apps/api
bun run worker:ingest
```

## Optional env vars
- `NBA_API_PROXY` — proxy URL if you need to route stats.nba.com through a proxy.
- `NBA_API_TIMEOUT_MS` — timeout per request (default 30000).

## Passing a proxy from Bun
If you set `INGEST_PROXY_URL` in `apps/api/.env`, the Bun worker will forward it to the sidecar.

## Notes
- The sidecar calls `stats.nba.com` using `nba_api.stats.library.http.NBAStatsHTTP`, which applies NBA-appropriate headers and request parameters.
- This does not bypass IP blocks; if your network is blocked, use a proxy and set `NBA_API_PROXY`.
