# Hoop Hub Web App

SvelteKit frontend + server routes for the Hoop Hub local POC.

## Scripts

```bash
bun run dev
bun run check
bun run test
bun run test:live-smoke
bun run nightly:bootstrap -- --slate-date 2026-04-01
bun run nightly:bootstrap -- --fixture-data --slate-date 2026-04-01
bun run build
```

## Environment

- Planner runtime configuration should be set in `apps/web/.env` for local development.
- Required planner variables:
  - `OPENAI_API_KEY`
  - `OPENAI_PLANNER_MODEL`
- Optional live NBA fetch variables:
  - `HOOP_HUB_NBA_TIMEOUT_MS`
  - `HOOP_HUB_NBA_PROXY_URL`
  - standard `HTTPS_PROXY` / `HTTP_PROXY` are also supported, with `HOOP_HUB_NBA_PROXY_URL` taking precedence
  - proxy values may be full URLs like `http://user:pass@proxy.example:8080` or raw `host:port:user:pass` entries
  - `HOOP_HUB_NBA_PROXY_URL` also accepts newline-delimited proxy lists and tries them in order
- By default, persistent cache data is stored in a per-worktree SQLite file under `~/.hoop-hub/data/<hash>/hoop-hub.sqlite`. Set `HOOP_HUB_DB_PATH` to override it.

## Current API Routes

- `GET /api/health`
- `POST /api/query`
- `POST /api/stats/query`
- `GET /api/query-trace/:traceId`

## Notes

- Current query execution is semantic-executor-backed for the supported statistical shapes:
  - player rankings
  - player trends
  - player comparisons
  - team defensive rankings
- `POST /api/query` is the primary natural-language planner route in front of the same semantic executor used by `POST /api/stats/query`.
- Traces now expose canonical `resolvedQuery` data, source calls, cache/freshness details, and warnings instead of relying on legacy planner output.
- Player resolution uses the shared seeded player-directory snapshot plus curated aliases; future engine work should reuse that path instead of embedding local name maps.
- Semantic query execution reads stored endpoint payloads only. On an empty DB, supported queries return typed `nightly_data_unavailable` coverage gaps until nightly bootstrap materializes the required rows.
- `bun run nightly:bootstrap -- --slate-date YYYY-MM-DD` is the supported path for writing authoritative nightly cache rows for the current-season runtime, plus supported demo-season backfill rows when they are still missing.
- `bun run nightly:bootstrap -- --fixture-data --slate-date YYYY-MM-DD` is the offline local-dev fallback when `stats.nba.com` is unreachable from the current machine or network.
- Stored reads select the latest snapshot at or before the query date, so previous-night materializations remain usable on later days.
- The legacy mock planner/query-engine remains in the repo for compatibility tests, but new execution behavior should be added to the semantic executor path, not the legacy path.
- The live smoke path is isolated from default PR CI and runs through `.github/workflows/live-smoke.yml`.
- Root project status and roadmap live in the repository [README](../../README.md).
- A compact source-of-truth for future agents lives in [../../agents/current-state.md](../../agents/current-state.md).
- Recent bootstrap/runtime decisions are summarized in [../../agents/project-log.md](../../agents/project-log.md).
