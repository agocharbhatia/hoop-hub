# Current State

This file is the short source of truth for future agents. Use it before relying on older roadmap language or legacy planner code.

## Shipped Engine State

- The production natural-language runtime is `POST /api/query` in front of the dynamic tool-loop agent in `apps/web/src/lib/server/agent/`.
- `POST /api/stats/query` is the primary structured tool contract.
- `POST /api/query` is the primary natural-language route and is no longer closed to the legacy planner's supported shapes.
- `GET /api/query-trace/:traceId` returns semantic trace payloads for structured runs and `runtime: "dynamic_agent"` trace payloads for agent runs, including tool calls, cache/freshness data, warnings, and source calls.
- Supported semantic query families today:
  - player rankings
  - player trends
  - player comparisons
  - team defensive rankings
- Structured responses should be treated as the core artifact. Summaries are secondary to canonical rows.
- The legacy planner remains in the tree for compatibility tests and direct orchestrator usage, but it is no longer the default `/api/query` runtime.

## Data and Resolution State

- Semantic query execution now reads stored endpoint payloads only; it no longer exposes request-level live fallback.
- Dynamic agent endpoint calls use the cataloged NBA Stats endpoint client live-first with SQLite caching. `HOOP_HUB_NBA_PROXY_URL` is needed on networks where direct `stats.nba.com` requests are blocked.
- Finalized nightly ingestion/materialization is still not implemented yet, so missing stored endpoint data currently returns typed `coverage_gap` responses.
- Player resolution now goes through the shared seeded player-directory snapshot in `apps/web/src/lib/server/players/player-directory.ts`.
- Curated aliases sit on top of canonical player identity; do not reintroduce ad hoc player name maps in new execution code.
- Slice 2 planning is now locked around a nightly bootstrap CLI/service that writes authoritative nightly raw-cache rows and teaches reads to use the latest stored snapshot at or before the query date.

## Trace and Session State

- Traces should expose canonicalized execution state through `resolvedQuery`, not raw caller input when normalization/resolution changed it.
- The production natural-language route no longer uses `sessionId`; the UI should not imply real conversational memory.

## Legacy Boundary

- The repo still contains the old planner/mock-engine path for compatibility coverage.
- Do not add new product behavior to the legacy mock planner/query-engine unless the task is explicitly about compatibility tests or migration.
- Future engine work should consolidate around one semantic runtime instead of extending both paths in parallel.

## Near-Term Gaps

- nightly-first materialization and stored-data-first reads
- broader dynamic-agent endpoint coverage, evaluation, and model prompt hardening
- broader structured planning beyond the current supported query families
- derived/computed metric execution
- persisted session grounding
- richer answer/artifact composition on top of structured rows

## Verification Surface

- Default repo verification remains:
  - `cd apps/web && bun run check`
  - `cd apps/web && bun run test`
  - `cd apps/web && bun run build`
- Fixture-backed semantic tests are the main guardrail for default CI.
- Live integration smoke coverage should stay isolated from default PR gating.
