# Hoop Hub Roadmap

Last reconciled: 2026-07-10 at `cca7e38`.

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

The old planner, query orchestrator, answer renderer, and mock engine remain compatibility surfaces. New product behavior belongs in the dynamic agent or the structured semantic substrate, not in the legacy planner path.

## Current Limitations

- The eval corpus covers the highest-risk regressions but is not yet broad enough to characterize arbitrary-query reliability.
- The scheduled live workflow needs to exercise the dynamic-agent eval rather than the legacy planner smoke.
- Nightly materialization is resumable and useful locally, but it is not yet a production scheduler with freshness SLOs, historical breadth, and operational alerting.
- Natural-language sessions are stateless. The product does not currently promise follow-up memory.
- Named-defender video attribution is unavailable. Team-opponent filtering is exact; defender attribution requires an evidence and confidence model rather than silent substitution.
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

- Grow the eval corpus from the initial regression set to a representative matrix of metrics, filters, seasons, splits, compound asks, artifacts, clips, empty results, partial data, and adversarial prompts.
- Track numeric correctness, artifact reconciliation, tool choice, warning hygiene, latency, tool count, token use, cost, and repeated-run stability.
- Run a small scheduled live canary independently from deterministic PR CI.
- Add browser-level playlist and artifact acceptance coverage.

Exit criteria: every advertised query family has deterministic cases, prompt variants, failure cases, and a live canary; releases have explicit quality gates.

### Phase 2 — Canonical data reliability

- Operate resumable scheduled ingestion with freshness states and alerts.
- Distinguish finalized, provisional, stale, and unavailable data.
- Refresh scheduled/live/final game states correctly instead of treating the first snapshot as permanently authoritative.
- Add historical backfill and data-quality checks for schema drift, missing subjects, duplicates, and row-count anomalies.
- Materialize common shot/event indexes so clip searches do not repeatedly scan full raw logs.
- Move production state from local SQLite to a server-grade store when multi-user deployment begins.

Exit criteria: supported answers remain reproducible during upstream outages and expose accurate freshness and completeness.

### Phase 3 — Query breadth and execution consolidation

- Expand home/away, win/loss, starter/bench, playoffs, clutch, opponent, lineup, and on/off splits.
- Support richer team, game, schedule, standings, and multi-part questions.
- Introduce a typed intermediate query representation so equivalent phrasings compile to equivalent execution.
- Keep filtering, calculation, ordering, joins, and artifact construction server-owned.
- Retire legacy planner/orchestrator code after compatibility dependencies are removed.

Exit criteria: capability growth is primarily typed data/execution work, not prompt-specific branches.

### Phase 4 — Grounded conversation

- Persist resolved entities, seasons, filters, prior query representation, grounded results, trace IDs, artifacts, and explicit user corrections.
- Resolve follow-ups such as “in the playoffs,” “compare him to Scottie,” “chart that,” and “only show the makes.”
- Compile every follow-up into a new standalone resolved query and trace.

Exit criteria: follow-ups are reproducible and do not rely on opaque transcript inference.

### Phase 5 — Product experience

- Add sortable/downloadable tables, chart interaction, drill-down, filter chips, saved searches, and shareable result URLs.
- Allow chart/table selections to become clip searches.
- Improve playlist buffering, retry, autoplay feedback, and unavailable-media states.
- Add CSV/image export before optional ffmpeg playlist compilation.

Exit criteria: users can inspect, refine, save, share, and export grounded research flows.

### Phase 6 — Advanced basketball intelligence

- Prototype defender attribution using play-by-play, substitutions, on-court lineups, shot events, and tracking/matchup data where legitimately available.
- Label attribution as observed, inferred, or team-only and attach confidence/evidence.
- Expand play-type and lineup analysis only after evaluation data supports trustworthy claims.

Exit criteria: the product never presents inferred defender attribution as exact observation.

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
