# Hoop Hub Worklog

## 2026-02-05
- Ingestion loop ran overnight and exposed a persistent failure mode: `season_stats_endpoint` for `leaguedashplayershotlocations` returning non-JSON (`NBA sidecar 502 InvalidResponse`).
- Added bounded retry controls (`INGEST_MAX_TASK_ATTEMPTS`, `INGEST_MAX_RETRY_DELAY_MS`) to prevent unbounded retry loops.
- Updated worker behavior to mark known non-retryable invalid JSON failures as `failed` and continue processing the rest of the queue.
- Maintained successful ingestion path for `leaguedashplayerstats` and `game_pbp`.
- Added `ingest:unstick` script to mark stuck ingest tasks as failed without hand-writing SQL.
- Added layered env profile loading (`ENV_FILE`) and tunnel scripts (`ingest:status:tunnel`, `worker:ingest:tunnel`) to avoid repeated manual exports.
- Fixed stat resolution mismatch (`PTS` vs endpoint-prefixed stat IDs) so NLQ stat queries return rows.
- Updated NLQ stat output to include `entity_name` from `stats_fact.dims_map` fallback when dimension tables are empty.
- Added a server-driven `presentation` response contract (`version: 2`, `layout: stack`, typed block union) while preserving legacy NLQ fields for backward compatibility.
- Implemented deterministic NLQ presentation policy engine with guarded LLM hints (`presentation.goal`, `preferred_views`, `max_blocks`) and schema validation/fallback behavior.
- Added shot-visualization data path: parsed/clamped half-court `x`/`y` points from `pbp_event.dims_map`, plus shot-zone aggregation (`attempts`, `makes`, `fg_pct`).
- Added reusable Svelte presentation block renderer with Apache ECharts components for `line`, `bar`, `scatter`, `shot_chart_xy`, and `shot_chart_zone`, plus table/text/kpi/clips blocks.
- Added API test coverage for presentation schema, selection matrix, deterministic hint behavior, and shot-viz normalization/aggregation.
- Updated table rendering UX to avoid oversized message cards: capped-height scroll window, sticky headers, sortable columns, and expand/collapse controls.
- Added visualization-level interactivity controls (reset/expand, zoom/pan via ECharts dataZoom, shot made/missed toggles, zone sort toggles, clips list expand/collapse).
- Expanded responsive layout width usage on desktop (`--content-max` driven chat/composer width) while tightening mobile spacing/behavior.

## Lessons / Process Improvements
- Keep long-running workers bounded by max attempts and classify retryable vs non-retryable errors.
- Always inspect high-attempt tasks in `ingest_task` before leaving an overnight run unattended.
- For fragile upstream endpoints, isolate failures to endpoint-level tasks so the rest of the pipeline can complete.
- Keep rendering decisions server-owned and validated so clients remain thin and consistent.
- Treat LLM output as hints, then apply deterministic policy and strict schemas before emitting UI contracts.
- Prefer additive API evolution (`presentation` alongside legacy fields) to reduce rollout risk across clients.
- Bound long tabular/clip outputs inside fixed viewport regions and provide explicit expansion actions to keep chat threads scannable.
- For wide screens, define a high but bounded content max width instead of narrow fixed containers; pair with mobile-first media queries.
