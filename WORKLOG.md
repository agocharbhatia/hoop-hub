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
- Refactored Python sidecar to class-driven endpoint execution using `nba_api.stats.endpoints.<module>` defaults; added `/endpoints` inventory and structured error contract.
- Added ingest manifest model (Phase 1 core stats + game/PBP enrichment endpoints) with DB-backed endpoint metadata in `ingest_endpoint_manifest`.
- Added endpoint health tracking in `ingest_coverage` and per-run debug traces in `ingest_run_log`.
- Expanded ClickHouse `stats_fact` schema with `source_module`, `dataset_name`, `metric_key`, and `is_rank_metric`.
- Hardened stats parser to treat identifier columns as dimensions and mark rank columns as non-query metrics.
- Refactored ingest worker for manifest-driven tasking, game endpoint fan-out, bounded retry/circuit behavior, and scheduled recurring seed tasks.
- Added ingest observability APIs and script improvements:
  - `GET /api/ingest/support-matrix`
  - `GET /api/ingest/errors`
  - `GET /api/ingest/endpoints`
  - `POST /api/ingest/query-support`
  - richer `ingest:status` coverage/error output.
- Added chat composer support hint in web UI using pre-query support checks.
- Added/updated API tests for manifest coverage and parser correctness.
- Fixed ClickHouse memory pressure on large stats ingests by chunking JSONEachRow inserts (`CLICKHOUSE_INSERT_BATCH_ROWS`) with adaptive split-on-memory-error fallback.
- Reduced stats volume and leaderboard distortion by excluding `_RANK` columns from fact ingestion.
- Improved support-matrix/query-support semantics to treat queued/running endpoint tasks as `partial` support instead of `not_supported`.
- Improved ingest status visibility by resolving module from payload endpoint fallback when module key is absent.
- Added targeted memory-failure recovery:
  - `POST /api/ingest/requeue-memory-failures` (dry-run/apply, module filter, limit, failed-vs-retry control)
  - `bun run ingest:requeue-memory` CLI script with the same controls.

## Lessons / Process Improvements
- Keep long-running workers bounded by max attempts and classify retryable vs non-retryable errors.
- Always inspect high-attempt tasks in `ingest_task` before leaving an overnight run unattended.
- For fragile upstream endpoints, isolate failures to endpoint-level tasks so the rest of the pipeline can complete.
- For `nba_api`, class defaults are materially more reliable than ad-hoc request parameter construction.
- Keep ingest state (`backfill_year`) bounded to active backfill windows so endpoint expansion re-seeds correctly.
- Surface support state before execution in UI to reduce user confusion when data coverage is partial.
- Large endpoint payloads require chunked ingestion writes; single-batch JSONEachRow posts can trip ClickHouse memory limits even on moderate datasets.
