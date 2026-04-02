# Project Log

## 2026-04-01

- PRD drafted: `OpenAI Planner Runtime For POST /api/query In The Current Stats Domain`.
- Canonical issue: `#9`.
- Core architecture choice: add one primary natural-language planner route in front of the existing semantic executor, while keeping the structured stats route public and removing the old chat route.
- Workflow assumptions: use deterministic planner tests with a fake adapter, keep planner output closed to the current stats slice, and treat planner outages or invalid structured output as real server errors rather than typed coverage gaps.
- PRD sliced into implementation issues `#10` through `#14`, and the approved execution graph was mirrored into `.sandcastle/tasks.yaml`.
- Slice `planner_runtime_rankings` established `POST /api/query` as the new planner boundary for supported player-ranking asks, with planner output revalidated through the structured semantic contract before executor delegation.
- Planner non-ok decisions now persist semantic traces with `resolvedQuery: null` and no source calls, so unsupported coverage stays debuggable without implying execution happened.
- Slice `planner_player_trends` extends that boundary to player trends with safe planner-side metric clarification: scoring language can infer `pts`, explicit last-N windows stay in the planned query, and vague trend asks should stop with `clarification_needed` plus `missing_metric` instead of guessing.
- Slice `migrate_ui_and_remove_chat_route` removes `POST /api/chat/query` as the production natural-language path, migrates route and trace coverage to `POST /api/query`, and strips UI session/follow-up cues so the app contract matches the actual planner/runtime behavior.
## planner_runtime_rankings

- Title: Establish /api/query planner runtime for player rankings and typed unsupported gaps
- Module scope: planner contracts and schema, OpenAI planner adapter, planner service, query route orchestration, trace persistence for planner non-ok responses
- Interface contract: POST /api/query accepts { question: string } | public response remains StatsQueryResponse | POST /api/stats/query remains the direct structured executor route | planner outputs a closed validated decision contract before executor delegation
- Tests: add deterministic planner service tests for planned and coverage-gap decisions | add /api/query route tests for rankings, unsupported asks, and server-error behavior | keep existing executor tests green
## planner_player_trends

- Title: Add player trend planning with safe metric clarification
- Module scope: planner service, planner schema, query route tests, semantic executor integration path
- Interface contract: player trend questions plan into canonical metric ids and supported semantic filters | vague trend asks return clarification_needed with no executor call | executor remains the canonical grounding authority
- Tests: add deterministic planner tests for scoring inference and missing_metric | add /api/query route tests for supported and clarification-needed trend asks

## planner_player_comparisons

- Title: Add player comparison planning with subject-order guarantees
- Module scope: planner service, planner schema, query route tests, comparison integration path
- Interface contract: comparison asks preserve subject order from the user question | compare-without-metric defaults safely to pts | incomplete comparison asks return clarification_needed with no executor call
- Tests: add deterministic planner tests for compare planning and subject order | add /api/query route tests for compare success and compare_requires_two_subjects

## planner_team_defense_rankings

- Title: Add team defensive ranking planning to the new runtime
- Module scope: planner service, planner schema, query route tests, team ranking integration path
- Interface contract: team defensive ranking asks plan into `rank/team` with canonical `drtg` and empty subject | adjacent unsupported team asks still stop as typed `coverage_gap` responses with no executor call
- Tests: add deterministic planner tests for supported team defense planning and unsupported adjacent team asks | add `/api/query` route tests for team defense success and typed unsupported gaps
## planner_team_defense_rankings

- Title: Add team defensive ranking planning to the new runtime
- Module scope: planner service, planner schema, query route tests, team ranking integration path
- Interface contract: team defensive ranking asks plan into rank/team with canonical drtg metric | unsupported adjacent team asks still fail as typed coverage gaps | public response and trace semantics remain unchanged
- Tests: add deterministic planner tests for supported and unsupported team asks | add /api/query route tests for team defensive ranking behavior
## migrate_ui_and_remove_chat_route

- Title: Remove /api/chat/query and switch the app UI to /api/query
- Module scope: natural-language route boundary, UI query flow, route and trace tests
- Interface contract: UI posts { question } to /api/query | no sessionId remains in the public natural-language route contract | /api/chat/query is removed as a production path
- Tests: migrate route tests from /api/chat/query to /api/query | update UI tests or smoke coverage if present | rerun the full repo verification surface after route removal

## planner runtime follow-up

- Live planner regressions exposed two missing hardening steps after the initial slice landed: the shared player directory overlay needed a curated bare `Curry -> Stephen Curry` alias for comparison asks, and planner outputs needed server-side season normalization so implicit phrases like `this season` become `null` before executor validation.
- Adding the bare `Curry` alias surfaced an overlap bug in mention extraction where alias matches nested inside longer canonical names were double-counted. The shared player-directory mention extractor now filters overlapping matches so alias overlays do not duplicate canonical names.
- Verified with deterministic regressions and a live local `/api/query` smoke pass:
  - `Compare Curry and Dame in 2023-24` returns `ok` with canonical resolved subjects `Stephen Curry` and `Damian Lillard`.
  - `Which teams have the best defensive rating this season?` returns `ok` and defaults season through the executor instead of 500ing on planner validation.

## 2026-04-02

- Slice `nightly_snapshot_reads_and_lazy_planner_cleanup` locked two runtime assumptions:
  - raw stored endpoint reads now select the latest snapshot whose `snapshot_date` is less than or equal to the query-time date, so previous-night materializations can satisfy next-day reads without changing public query contracts.
  - `POST /api/query` now loads the default OpenAI planner adapter lazily behind the route dependency boundary, so route imports and injected tests do not depend on eager planner-module loading.
- Slice `nightly_current_season_rankings_and_team_defense` adds a nightly bootstrap CLI/service for the two current-season league-wide ranking shapes, and its authoritative raw-cache writes are keyed to the requested `slateDate` rather than wall-clock ingest time so run bookkeeping and snapshot semantics stay aligned.
## nightly_snapshot_reads_and_lazy_planner_cleanup

- Title: Make nightly snapshots readable across days and lazily isolate the planner route
- Module scope: raw endpoint cache read semantics, data store latest-row lookup, query-time endpoint adapter reads, query route dependency wiring
- Interface contract: query-time stored reads select the latest matching snapshot where snapshot date is less than or equal to the query date | public query and trace contracts remain unchanged | test dependency injection for /api/query does not eagerly instantiate the default planner adapter
- Tests: add data-store tests for latest-row lookup across snapshot dates | add integration or route-level regression coverage for previous-day snapshot reuse | add route import or dependency-injection coverage for lazy planner creation

## nightly_current_season_rankings_and_team_defense

- Title: Bootstrap current-season nightly league-wide ranking and team-defense data
- Module scope: nightly bootstrap service, bootstrap CLI entrypoint, nightly run bookkeeping, current-season league-wide request planning
- Interface contract: bootstrap requires a slate date | authoritative nightly cache rows are written for current-season `leaguedashplayerstats` and `leaguedashteamstats` request shapes | nightly runs report `completed`, `partial`, or `failed` based on actual request outcomes
- Tests: add bootstrap service coverage for completed, partial, and failed bookkeeping | verify authoritative nightly cache writes are non-provisional and queryable from an empty DB | add CLI argument coverage for the required slate date
## nightly_current_season_rankings_and_team_defense

- Title: Bootstrap current-season league-wide nightly data for rankings and team defense
- Module scope: nightly bootstrap service, bootstrap CLI entrypoint, nightly run bookkeeping, current-season league-wide request planning
- Interface contract: bootstrap command accepts a required slate date | current-season league-wide ranking and team-defense request shapes are written as authoritative nightly cache rows | run status reports completed, partial, or failed honestly
- Tests: add bootstrap service tests for completed, partial, and failed run status | add ingest tests for authoritative nightly cache writes | add end-to-end coverage that ranking and team-defense queries work after bootstrap

## nightly_player_cohort_and_comparisons

- Title: Derive the nightly player cohort and bootstrap regular-season comparisons
- Module scope: nightly cohort derivation, checked-in demo allowlist, comparison-source bootstrap materialization
- Interface contract: nightly bootstrap derives a deterministic unique player cohort from current-season league-wide player stats plus the checked-in demo allowlist | bootstrap persists `playercareerstats` source rows for that cohort without changing public comparison query contracts
- Tests: add cohort-derivation coverage from league-wide payloads plus allowlist | add bootstrap coverage for per-player comparison materialization | verify comparison queries succeed from an empty DB after bootstrap
