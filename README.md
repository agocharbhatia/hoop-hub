# Hoop Hub

AI-powered NBA natural-language search engine.

Hoop Hub is currently a single Bun + SvelteKit app that answers grounded NBA stats questions through an OpenAI planner plus semantic executor runtime, backed by official NBA endpoint retrieval, SQLite caching, and semantic traces.

## Current Scope

- Primary structured route: `POST /api/stats/query`
- Primary natural-language route: `POST /api/query`
- Trace route: `GET /api/query-trace/:traceId`
- Supported semantic query families:
  - player rankings
  - player trends
  - player comparisons
  - team defensive rankings
- Player resolution uses the shared seeded player-directory snapshot and curated aliases.
- Semantic query execution reads stored endpoint payloads only. An empty DB returns typed `nightly_data_unavailable` coverage gaps until nightly bootstrap materializes the supported runtime cache.
- Nightly reads reuse the latest stored snapshot at or before the query date, so prior-day materializations remain readable on later days.
- The planner currently stays closed to the same four supported stats shapes as the semantic executor.

Detailed implementation context for future agents lives in [agents/current-state.md](agents/current-state.md), [agents/project-log.md](agents/project-log.md), and [`.docs/PLAN.md`](.docs/PLAN.md).

## TODO

- [x] Foundation: app scaffold, contracts, health route
- [x] Planning groundwork: normalization, metrics, validation
- [x] Official NBA endpoint adapters + SQLite cache
- [x] Structured semantic execution for the initial query families
- [x] Seeded player-directory resolution + canonical semantic traces
- [ ] Consolidate around one production semantic runtime and stop extending the legacy mock-engine path
- [ ] Broaden semantic planning and entity resolution beyond the current supported families
- [ ] Implement nightly-first ingest/materialization and stored-data-first reads
- [ ] Add grounded derived/computed metric execution
- [ ] Add persisted session grounding and stronger answer/artifact composition
- [ ] Add richer visualization artifacts
- [ ] Add the evaluation harness and performance gates
- [ ] Phase 2: play-by-play clip retrieval and ordered playlist output

## Local Setup

### Requirements

- Node `22.12.0+` (see [`.nvmrc`](.nvmrc))
- Bun

### Install + Run

```bash
cd apps/web
bun install
bun run dev
```

Bootstrap the supported nightly runtime cache from an empty DB:

```bash
cd apps/web
bun run nightly:bootstrap -- --slate-date 2026-04-01
```

When live access to `stats.nba.com` is unavailable, bootstrap the same supported runtime surface from checked-in fixtures for local verification:

```bash
cd apps/web
bun run nightly:bootstrap -- --fixture-data --slate-date 2026-04-01
```

The bootstrap path writes authoritative nightly rows for the current-season supported query surface, including league-wide rankings, team defensive rankings, the derived player comparison cohort, current-season player trends, and supported demo-season backfill rows when missing.

By default, persisted nightly data now lives in a per-worktree SQLite file under `~/.hoop-hub/data/<hash>/hoop-hub.sqlite`. Override it with `HOOP_HUB_DB_PATH` when you need a custom location.

Repo helpers:

```bash
./scripts/run-all.sh
./scripts/setup-workspace.sh
./scripts/bootstrap-live-data.sh 2026-04-01
./scripts/teardown-workspace.sh
```

`./scripts/setup-workspace.sh` now installs dependencies, copies matching repo env files such as `.env` and `apps/web/.env` from `SUPERSET_ROOT_PATH` when available, otherwise seeds missing env files from local examples, and bootstraps fixture-backed nightly data for the current date so new workspaces can answer supported demo queries immediately.

`./scripts/bootstrap-live-data.sh YYYY-MM-DD` deletes the current workspace DB if it exists and then runs a fresh live nightly bootstrap for that slate date.

### Verify

```bash
cd apps/web
bun run check
bun run test
bun run build
```

## CI

- GitHub Actions workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
- Default CI runs `bun ci`, `bun run check`, `bun run test`, and `bun run build` in `apps/web`
