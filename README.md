# Hoop Hub

AI-powered NBA natural-language search engine.

Hoop Hub is currently a single Bun + SvelteKit app that answers grounded NBA stats questions through a dynamic tool-loop agent for natural-language asks plus a structured semantic stats route, backed by official NBA endpoint retrieval, SQLite caching, and semantic traces.

## Current Scope

- Primary structured route: `POST /api/stats/query`
- Primary natural-language route: `POST /api/query`, now backed by a dynamic OpenAI tool-loop agent.
- Trace route: `GET /api/query-trace/:traceId`
- `/api/query` can iteratively resolve players/teams, call cataloged NBA Stats endpoints live-first, reuse SQLite raw endpoint cache rows, and return grounded prose plus artifact specs.
- Supported semantic query families:
  - player rankings
  - player trends
  - player comparisons
  - team defensive rankings
- Player resolution uses the shared seeded player-directory snapshot and curated aliases.
- Semantic query execution reads stored endpoint payloads only. An empty DB returns typed `nightly_data_unavailable` coverage gaps until nightly bootstrap materializes the supported runtime cache.
- Dynamic agent endpoint calls are live-first with SQLite caching. Set `HOOP_HUB_NBA_PROXY_URL` on networks where direct `stats.nba.com` access is blocked.
- Nightly reads reuse the latest stored snapshot at or before the query date, so prior-day materializations remain readable on later days.
- The legacy closed planner and semantic executor modules remain in the tree for compatibility and direct tests, but they are no longer the default `/api/query` runtime.

Detailed implementation context for future agents lives in [agents/current-state.md](agents/current-state.md), [agents/project-log.md](agents/project-log.md), and [`.docs/PLAN.md`](.docs/PLAN.md).

## TODO

- [x] Foundation: app scaffold, contracts, health route
- [x] Planning groundwork: normalization, metrics, validation
- [x] Official NBA endpoint adapters + SQLite cache
- [x] Structured semantic execution for the initial query families
- [x] Seeded player-directory resolution + canonical semantic traces
- [x] Dynamic `/api/query` agent with cataloged NBA Stats tool calls and dynamic trace payloads
- [ ] Consolidate legacy closed-planner compatibility once dynamic-agent coverage is broad enough
- [ ] Broaden structured semantic planning and entity resolution beyond the current supported families
- [ ] Implement nightly-first ingest/materialization and stored-data-first reads
- [x] Add grounded derived/computed metric execution (`aggregate_endpoint_rows` filters/groups/aggregates full result sets server-side)
- [x] Add richer visualization artifacts (line, bar, and half-court shot chart components render agent artifacts in the UI)
- [ ] Add persisted session grounding and stronger answer/artifact composition
- [x] Add the dynamic-agent evaluation harness and performance gates
- [x] Clip retrieval and playlist output (`find_video_clips` over `videodetailsasset` + sequential playlist player in the UI)

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

## Dynamic-Agent Evaluation

The default evaluation suite is deterministic and offline. It replays explicit model tool decisions through the real dynamic-agent service and uses endpoint fixtures for numeric, artifact, warning, clip-intent, and response-hygiene assertions:

```bash
cd apps/web
bun run eval
```

Live-model evaluation is a separate, explicit command. It uses the configured OpenAI model plus the normal NBA cache/live endpoint client and is never invoked by `bun run test` or the default CI workflow:

```bash
cd apps/web
bun run eval:live
```

The made-three case defaults to 20 live repetitions because its intent broadening was nondeterministic. Use focused filters or a repetition override for smaller smoke runs:

```bash
bun run eval -- --case scottie-made-threes-vs-boston
bun run eval:live -- --tag clips --repetitions 1
bun run eval:live -- --case scottie-made-threes-vs-boston --repetitions 20
```

Each invocation exits nonzero when a required gate fails and writes redacted `results.jsonl` plus `summary.md` under `apps/web/eval-results/<timestamp>-<mode>/` by default. Use `--output <directory>` to choose another report location, and `--help` for all filters.

Local evals certify the deterministic tool/parser/reconciliation path; only live evals exercise natural-language model decisions. Playlist contents are checked structurally here, while actual video playback and auto-advance still require browser QA.

## CI

- GitHub Actions workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
- Default CI runs `bun ci`, `bun run check`, `bun run test`, and `bun run build` in `apps/web`
