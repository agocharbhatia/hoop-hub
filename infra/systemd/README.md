# HoopHub systemd services (droplet)

These units keep HoopHub running continuously on a Linux server:
- `hoophub-sidecar.service` (FastAPI + `nba_api`)
- `hoophub-api.service` (Bun HTTP API)
- `hoophub-ingest-worker.service` (Bun ingest worker)

## Prerequisites

- Repo checked out at `/opt/hoop-hub`
- Bun installed at `/root/.bun/bin/bun`
- Python venv created at `/opt/hoop-hub/apps/ingest-python/.venv`
- API env file at `/opt/hoop-hub/apps/api/.env`

Recommended API env keys:
- `CLICKHOUSE_URL=http://127.0.0.1:8123`
- `CLICKHOUSE_USER`
- `CLICKHOUSE_PASSWORD`
- `POSTGRES_URL`
- `REDIS_URL`
- `INGEST_SIDECAR_URL=http://127.0.0.1:8008`
- `LLM_PROVIDER`
- `LLM_API_KEY`
- `LLM_MODEL`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_ENDPOINT`
- `S3_RAW_BUCKET`
- `S3_CLIP_BUCKET`
- `CLICKHOUSE_INSERT_BATCH_ROWS=2000` (or lower if memory pressure)

Optional sidecar env file:
- `/opt/hoop-hub/apps/ingest-python/.env`
- supports `NBA_API_PROXY` and `NBA_API_TIMEOUT_MS`

## Install services

```bash
cd /opt/hoop-hub
bash apps/api/scripts/install-systemd.sh
```

## Check status/logs

```bash
systemctl status hoophub-sidecar hoophub-api hoophub-ingest-worker --no-pager
journalctl -u hoophub-sidecar -f
journalctl -u hoophub-api -f
journalctl -u hoophub-ingest-worker -f
```

## Restart

```bash
systemctl restart hoophub-sidecar hoophub-api hoophub-ingest-worker
```

