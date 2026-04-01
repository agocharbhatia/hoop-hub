# Current State

This file is the short source of truth for future agents. Use it before relying on older roadmap language or legacy planner code.

## Shipped Engine State

- The production query boundary is the semantic executor in `apps/web/src/lib/server/semantic/query-service.ts`.
- `POST /api/stats/query` is the primary structured tool contract.
- `POST /api/chat/query` is a natural-language wrapper over the same semantic executor.
- `GET /api/query-trace/:traceId` returns semantic trace payloads with canonical `resolvedQuery`, cache/freshness data, warnings, and source calls.
- Supported semantic query families today:
  - player rankings
  - player trends
  - player comparisons
  - team defensive rankings
- Structured responses should be treated as the core artifact. Summaries are secondary to canonical rows.

## Data and Resolution State

- Semantic query execution now reads stored endpoint payloads only; it no longer exposes request-level live fallback.
- Finalized nightly ingestion/materialization is still not implemented yet, so missing stored endpoint data currently returns typed `coverage_gap` responses.
- Player resolution now goes through the shared seeded player-directory snapshot in `apps/web/src/lib/server/players/player-directory.ts`.
- Curated aliases sit on top of canonical player identity; do not reintroduce ad hoc player name maps in new execution code.

## Trace and Session State

- Traces should expose canonicalized execution state through `resolvedQuery`, not raw caller input when normalization/resolution changed it.
- `sessionId` is currently validated at the chat boundary, but the app does not yet persist or reload conversational state from it.
- Follow-up chips in the UI are a convenience affordance, not evidence of real multi-turn engine memory.

## Legacy Boundary

- The repo still contains the old planner/mock-engine path for compatibility coverage.
- Do not add new product behavior to the legacy mock planner/query-engine unless the task is explicitly about compatibility tests or migration.
- Future engine work should consolidate around one semantic runtime instead of extending both paths in parallel.

## Near-Term Gaps

- broader NL planning beyond the current supported query families
- nightly-first materialization and stored-data-first reads
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
