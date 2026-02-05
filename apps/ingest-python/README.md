# NBA API Sidecar (Python)

This service wraps the `nba_api` package and exposes HTTP endpoints for Bun ingestion.

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
In `apps/api/.env`:
```env
INGEST_SIDECAR_URL=http://127.0.0.1:8008
```

Then run the worker:
```bash
cd apps/api
bun run worker:ingest
```

## API

### `GET /endpoints`
Returns discovered `nba_api.stats.endpoints` modules with:
- module name
- endpoint name
- required constructor args
- constructor arg list
- default parameter keys

### `POST /stats`
Request body:
```json
{
  "module": "leaguedashplayerstats",
  "overrides": {
    "Season": "2024-25",
    "SeasonType": "Regular Season",
    "PerMode": "PerGame",
    "MeasureType": "Base"
  },
  "timeout_ms": 20000
}
```

Legacy compatibility: `endpoint` + `params` is still accepted.

Success response:
```json
{
  "module": "leaguedashplayerstats",
  "endpoint": "leaguedashplayerstats",
  "response_bytes": 123456,
  "payload": { "resultSets": [] }
}
```

Error response (`detail`):
```json
{
  "error_type": "invalid_json|timeout|network|param_validation|nba_error",
  "http_status": 502,
  "message": "...",
  "module": "...",
  "endpoint": "...",
  "retryable": true
}
```

## Optional env vars
- `NBA_API_PROXY` - proxy URL for NBA requests.
- `NBA_API_TIMEOUT_MS` - request timeout in milliseconds.

## Notes
- Sidecar is class-driven: it uses endpoint class defaults from `nba_api` and then applies overrides.
- This fixes failures caused by incomplete ad-hoc parameter sets.
