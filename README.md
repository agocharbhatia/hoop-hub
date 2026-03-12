# Hoop Hub

AI-powered NBA natural language search engine.

Users ask basketball questions in plain English, and Hoop Hub returns grounded stat answers with citations, optional visual artifacts, and step-by-step query provenance.

## Current State

- Bun + SvelteKit app scaffolded and running locally.
- Chat-first UI shell.
- Health endpoint: `GET /api/health`.
- Typed contracts for legacy chat/planning and structured stats queries.
- Milestone 1 planner foundation:
  - deterministic query intent normalization
  - metric registry + metric resolution logic
  - planner invariants and validation tests
- Slice 2 adapter/cache foundation:
  - official NBA endpoint adapter with fetch-through SQLite cache
  - TTL-aware cache keys and source-call trace persistence
  - environment toggles for live-fetch on/off and timeout control
- Vertical MVP flow with retrieval-backed prototype:
  - `POST /api/stats/query` as the structured primary lookup API
  - `POST /api/chat/query` retained as a legacy compatibility route
  - `GET /api/query-trace/:traceId`
  - unsupported/supported/error UI states
  - trace panel for "Show steps"
- Current retrieval behavior:
  - live-fetch-first against `stats.nba.com`, with cache hits and stale-cache fallback
  - `league_leaders` has real payload-backed answer composition
  - `player_trend`, `player_compare`, and `team_ranking` still use templated answer composition after retrieval
- Data freshness behavior:
  - traces can report `provisional_live` when a response came from a live fetch
  - nightly-run schema/storage exists, but finalized nightly-first ingestion is not implemented yet
- Local run orchestration via `scripts/run-all.sh`.

## What Is Actively Being Worked On

- Finalizing UI reference and interaction system for the productionized chat + artifact experience.
- Reconciling the long-term data strategy:
  - complete retrieval-backed answer composition for currently supported intents
  - or shift to the intended nightly-first ingestion/finalization path before adding more compute features

## Roadmap / TODO

- [x] Slice 0: Foundation (app scaffold, contracts wiring, health endpoint)
- [x] Slice 1: Query planning foundation (query plan + metrics registry + tests)
- [x] Vertical MVP mocked query flow (chat API + trace API + UI states)
- [x] Slice 2: Official NBA data adapters + SQLite cache TTL strategy
- [ ] Finish retrieval-backed answer composition for supported intents
- [ ] Implement nightly-first ingest/finalization and stored-data-first reads
- [ ] Slice 3: Restricted computed-metric DSL + DuckDB execution
- [ ] Slice 4: End-to-end grounded answers + citations + trace persistence hardening
- [ ] Slice 5: Visualization artifact rendering (table/bar/line/scatter)
- [ ] Slice 6: 100-query evaluation harness + correctness/performance gates
- [ ] Slice 7 (Phase 2): Play-by-play clip retrieval and ordered playlist output

## Local Setup

### Requirements

- Node `22.12.0+` (see [`.nvmrc`](.nvmrc))
- Bun (latest stable)

### Install + Run

```bash
cd apps/web
bun install
bun run dev
```

Or run the repo orchestration script:

```bash
./scripts/run-all.sh
```

### Verify

```bash
cd apps/web
bun run check
bun run test
bun run build
```

## CI

- GitHub Actions workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
- Runs on push to `main` and pull requests.
- Executes in `apps/web`:
  - `bun ci`
  - `bun run check`
  - `bun run test`
  - `bun run build`
