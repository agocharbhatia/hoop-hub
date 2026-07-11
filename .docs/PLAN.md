# Hoop Hub Roadmap

Last reconciled: 2026-07-10 after the Phase 1-3 foundation pass.

This is the current product and engineering roadmap. Historical implementation briefs live under `.docs/prds/`; completed slice history lives in `agents/project-log.md`.

## Product Goal

Hoop Hub is a grounded NBA research assistant. A user should be able to ask an unfamiliar basketball question, see how it was interpreted, trust every number and artifact, refine the question conversationally, and retrieve matching plays without silent scope changes.

## Shipped Architecture

- `POST /api/query` is the primary natural-language route. It runs the dynamic tool-loop agent in `apps/web/src/lib/server/agent/`.
- `POST /api/stats/query` is the structured semantic route for typed stored-data queries.
- `GET /api/stats/capabilities` publishes the structured route's supported surface.
- `GET /api/query-trace/:traceId` returns canonical execution traces for dynamic-agent and structured runs.
- Dynamic endpoint retrieval is live-first with SQLite caching. Structured semantic execution is stored-data-first and returns typed coverage gaps when required materialization is absent.
- Player and team identity resolution use shared canonical directories plus explicit alias overlays.
- Server-owned computation supports full-result filtering, grouping, aggregation, and chronological time-series analysis.
- Tables, line charts, bar charts, shot charts, and video playlists are reconciled from grounded tool output.
- Standard video events use direct NBA video measures. Custom shot searches filter `shotchartdetail` and join videos exactly on `(GAME_ID, GAME_EVENT_ID)`.
- Deterministic and live dynamic-agent eval modes are available through `bun run eval` and `bun run eval:live`; custom-shot contract cases run through `bun run eval:custom-shots`.
- Dynamic-agent traces and eval reports include model call/token usage, with cost estimates when operator pricing is configured.
- Nightly materialization has a scheduled workflow plus a deterministic health audit for request/cache integrity and finalized/provisional/stale/unavailable freshness.
- The dynamic agent can delegate supported stored-data questions to the typed semantic executor; semantic tables are reconciled from executor rows rather than model-authored values.

The old planner, query orchestrator, answer renderer, and mock engine remain compatibility surfaces. New product behavior belongs in the dynamic agent or the structured semantic substrate, not in the legacy planner path.

## Current Limitations

- The eval corpus covers 22 deterministic prompt variants across core regression families plus seven custom-shot cases, but it is not yet broad enough to characterize arbitrary-query reliability.
- Scheduled nightly materialization and live dynamic-agent canaries exist, but production alert routing, freshness SLO dashboards, and broad historical backfill do not.
- Natural-language sessions are stateless. The product does not currently promise follow-up memory.
- Named-player matchup stats use NBA Advanced Stats Player Tracking attribution with explicit evidence and sample-size context. Named-defender clip attribution remains unavailable because the aggregate matchup feed has no event IDs.
- Playlists are sequential browser playback, not compiled single-file exports.
- The production deployment, authentication, quota, observability, backup, and server-grade data-store story is not complete.

## Ordered Roadmap

### Phase 0 — Repository reconciliation

Status: completed 2026-07-10. Keep these checks as ongoing repository hygiene.

- Keep all current-state documentation aligned with the shipped routes and runtime.
- Archive completed GitHub slices and leave only active work open.
- Maintain one release checklist for deterministic, live, and browser verification.
- Keep scheduled live smoke aligned with the dynamic-agent runtime.

Exit criteria: docs contain no obsolete public routes or request policies; completed issues are closed; CI and live-smoke commands target current code.

### Phase 1 — Trust and evaluation

Status: foundation completed 2026-07-10; corpus growth remains continuous.

- Grow the eval corpus from the initial regression set to a representative matrix of metrics, filters, seasons, splits, compound asks, artifacts, clips, empty results, partial data, and adversarial prompts.
- Track numeric correctness, artifact reconciliation, tool choice, warning hygiene, latency, tool count, token use, cost, and repeated-run stability.
- Run a small scheduled live canary independently from deterministic PR CI.
- Add browser-level playlist and artifact acceptance coverage.

Exit criteria: every advertised query family has deterministic cases, prompt variants, failure cases, and a live canary; releases have explicit quality gates.

Shipped in the foundation pass: prompt-variant execution, conditional and split questions, semantic-tool grounding, endpoint failure hygiene, artifact reconciliation assertions, model token/call telemetry, configurable cost estimates, scheduled live canary coverage, and real-browser stat/chart/clip acceptance. Future additions should extend the same data-defined matrix.

### Phase 2 — Canonical data reliability

Status: operational foundation completed 2026-07-10; production-scale storage and historical breadth remain deferred.

- Operate resumable scheduled ingestion with freshness states and alerts.
- Distinguish finalized, provisional, stale, and unavailable data.
- Refresh scheduled/live/final game states correctly instead of treating the first snapshot as permanently authoritative.
- Add historical backfill and data-quality checks for schema drift, missing subjects, duplicates, and row-count anomalies.
- Materialize common shot/event indexes so clip searches do not repeatedly scan full raw logs.
- Move production state from local SQLite to a server-grade store when multi-user deployment begins.

Exit criteria: supported answers remain reproducible during upstream outages and expose accurate freshness and completeness.

Shipped in the foundation pass: scheduled resumable materialization, health auditing for run/request/cache agreement, JSON/checksum validation, expiry and provisional-state detection, fixture-backed operator verification, and refresh behavior for stale non-final scoreboard snapshots. Remaining scale work is historical backfill/anomaly policy, precomputed shot/event indexes, alert routing, and migration from SQLite when multi-user deployment requires it.

### Phase 3 — Query breadth and execution consolidation

Status: typed execution bridge completed 2026-07-10; breadth expansion and legacy deletion remain incremental.

- Expand home/away, win/loss, starter/bench, playoffs, clutch, opponent, lineup, and on/off splits.
- Support richer team, game, schedule, standings, and multi-part questions.
- Introduce a typed intermediate query representation so equivalent phrasings compile to equivalent execution.
- Keep filtering, calculation, ordering, joins, and artifact construction server-owned.
- Retire legacy planner/orchestrator code after compatibility dependencies are removed.

Exit criteria: capability growth is primarily typed data/execution work, not prompt-specific branches.

Shipped in the foundation pass: a capability-derived `execute_semantic_query` agent tool, canonical semantic status/provenance propagation, server-grounded table reconciliation, and first-class `split/player` execution for win/loss and home/away averages. Starter/bench, playoffs, clutch, opponent, lineup, and on/off require honest source/materialization support before being advertised. Legacy compatibility code remains until its direct consumers are migrated.

### Phase 4 — Defender and advanced basketball context

Status: first high-confidence vertical slice shipped 2026-07-10; event-level and inferred attribution remain R&D.

- Support arbitrary offensive-player versus defensive-player season matchups through NBA's tracking-derived `leagueseasonmatchups` feed.
- Preserve offensive and defensive roles, expose games/minutes/partial possessions/shooting/playmaking fields, and label thin samples.
- Keep tracking-derived official matchup attribution distinct from manual event observation and from lineup/PBP inference.
- Add event-level evidence and defender-attributed clips only when a trustworthy join to shot events exists.
- Prototype lineup/PBP inference for gaps in tracking coverage with evaluated confidence thresholds; never promote inferred attribution to observed.

Exit criteria: arbitrary player-pair matchup questions are grounded and evidence-labeled; inferred results remain visibly distinct; clips never silently use team-level substitution.

### Phase 5 — Grounded conversation

- Persist resolved entities, seasons, filters, prior query representation, grounded results, trace IDs, artifacts, and explicit user corrections.
- Resolve follow-ups such as “in the playoffs,” “compare him to Scottie,” “chart that,” and “only show the makes.”
- Compile every follow-up into a new standalone resolved query and trace.

Exit criteria: follow-ups are reproducible and do not rely on opaque transcript inference.

### Phase 6 — Product experience

- Add sortable/downloadable tables, chart interaction, drill-down, filter chips, saved searches, and shareable result URLs.
- Allow chart/table selections to become clip searches.
- Improve playlist buffering, retry, autoplay feedback, and unavailable-media states.
- Add CSV/image export before optional ffmpeg playlist compilation.

Exit criteria: users can inspect, refine, save, share, and export grounded research flows.

### Phase 7 — Production readiness

- Add authentication, quotas, rate limiting, secret management, request isolation, monitoring, backups, restore drills, and deployment/rollback runbooks.
- Establish latency, availability, correctness, freshness, and cost SLOs.
- Load-test the production-shaped system and scale ingestion/query workers independently.

Exit criteria: Hoop Hub can support real users with observable reliability and bounded cost.

## Release Gate

Use [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for every merge or release candidate. Deterministic green checks alone do not certify live model behavior, upstream NBA retrieval, or browser media playback.

## Source-of-Truth Order

1. `agents/current-state.md` — concise shipped runtime state.
2. This roadmap — current priorities and sequencing.
3. `README.md` and `apps/web/README.md` — setup and operator commands.
4. `agents/project-log.md` — chronological implementation history.
5. `.docs/prds/` — historical approved slice requirements, not current-state documents.
