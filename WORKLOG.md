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

## Lessons / Process Improvements
- Keep long-running workers bounded by max attempts and classify retryable vs non-retryable errors.
- Always inspect high-attempt tasks in `ingest_task` before leaving an overnight run unattended.
- For fragile upstream endpoints, isolate failures to endpoint-level tasks so the rest of the pipeline can complete.
