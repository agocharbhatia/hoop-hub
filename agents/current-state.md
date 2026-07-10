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
- persisted session grounding
- single-file clip compilation/export (ffmpeg); the shipped playlist player auto-advances through clips instead

Clip retrieval now has direct-event and exact custom-shot paths. Standard event intents still map straight to `videodetailsasset` context measures (`made_three` -> `FG3M`, `made_field_goal` -> `FGM`, plus direct assist/block/steal/rebound/turnover measures). `custom_shot` fetches the full `shotchartdetail` log, applies canonical result/value/zone/zone-area/action-family/period/distance filters, then makes at most one broad video request and joins only on `(GAME_ID, GAME_EVENT_ID)`. The 40-clip cap is applied after joining, and tool data exposes matching/joined/missing counts, invalid keys, cap state, returned event ids, and applied filters. `src/lib/server/agent/custom-shot-clips.ts` owns the deterministic filter/join logic; `video-clips.ts` can parse an uncapped feed for this path.

Custom video artifacts are reconciled from successful tool output rather than trusted model-authored clip lists. Complete joins do not warn; partial joins produce one deterministic product warning. Missing/malformed ids and unplayable or absent videos remain missing instead of admitting unrelated feed events. The explicit-cue guard also rejects pre-fetch tool calls that omit or contradict clear mid-range, corner, action, result, shot-value, or quarter language, so the model can retry with the complete canonical intent. The observed action vocabulary includes variants such as `Pullup Jump shot`, `Running Pull-Up Jump Shot`, `Step Back Jump shot`, driving/cutting/running layups and dunks, hooks, floaters, fadeaways, turnarounds, putbacks, tips, alley-oops, banks, and finger rolls. Novel action terminology outside the semantic families is currently unsupported and must not be silently broadened.

Opponent filtering is team-level. Named-defender filtering remains unavailable, and the existing guard rejects a resolved defender-to-team substitution unless the user first approves that broader scope. Browser autoplay policies may require the native play control after `Play all`; this is distinct from missing video. `bun run eval` runs the deterministic custom-video contract suite; live model/data/playback checks are still non-gating.

Derived/computed metrics now run through the agent's `aggregate_endpoint_rows` tool (server-side filter/group/aggregate over full result sets), and line/bar/shot-chart artifacts render as real chart components (`src/lib/components/charts/`, QA page at `/dev/charts`). The player directory re-seeds stored DBs whenever the checked-in snapshot version changes.

## Verification Surface

- Default repo verification remains:
  - `cd apps/web && bun run check`
  - `cd apps/web && bun run test`
  - `cd apps/web && bun run build`
  - `cd apps/web && bun run eval`
- Fixture-backed semantic tests are the main guardrail for default CI.
- Live integration smoke coverage should stay isolated from default PR gating.
