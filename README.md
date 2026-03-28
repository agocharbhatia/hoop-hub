# Hoop Hub

AI-powered NBA natural-language search engine.

Hoop Hub is currently a single Bun + SvelteKit app that answers grounded NBA stats questions through a semantic executor, backed by official NBA endpoint retrieval, SQLite caching, and semantic traces.

## Current Scope

- Primary structured route: `POST /api/stats/query`
- Natural-language wrapper: `POST /api/chat/query`
- Trace route: `GET /api/query-trace/:traceId`
- Supported semantic query families:
  - player rankings
  - player trends
  - player comparisons
  - team defensive rankings
- Player resolution uses the shared seeded player-directory snapshot and curated aliases.
- Retrieval is still live-fetch-first with cache fallback. Nightly-first materialization is not implemented yet.
- `sessionId` is validated at the chat boundary but does not yet persist conversational context.

Detailed implementation context for future agents lives in [agents/current-state.md](agents/current-state.md) and [`.docs/PLAN.md`](.docs/PLAN.md).

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

Repo helpers:

```bash
./scripts/run-all.sh
./scripts/setup-workspace.sh
./scripts/teardown-workspace.sh
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
- Default CI runs `bun ci`, `bun run check`, `bun run test`, and `bun run build` in `apps/web`
