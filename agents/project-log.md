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
- Slice `nightly_bootstrap_e2e_and_docs_refresh` locks the shipped empty-DB bootstrap contract at the public route layer: supported queries return `nightly_data_unavailable` before bootstrap, both public query routes recover to `ok` after bootstrap, and prior-day snapshots remain readable on later days.
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
## nightly_player_cohort_and_comparisons

- Title: Derive the nightly player cohort and bootstrap regular-season comparisons
- Module scope: player cohort derivation, checked-in demo allowlist, player comparison nightly materialization
- Interface contract: the cohort derives from current-season league-wide player stats plus a deterministic allowlist | comparison bootstrap remains regular-season-only | public comparison query contracts remain unchanged
- Tests: add tests for cohort derivation from league-wide player stats plus the demo allowlist | add bootstrap service tests for comparison materialization | add integration coverage that supported comparison queries return ok after bootstrap

## nightly_current_season_player_trends

- Title: Bootstrap current-season player trends for the derived cohort
- Module scope: current-season player trend materialization, trend-oriented nightly request planning, empty-payload success handling
- Interface contract: nightly bootstrap now persists current-season regular-season `playergamelog` rows for every player in the already-derived cohort alongside comparison rows | valid empty trend payloads still count as successful materialization | public trend query contracts remain unchanged
- Tests: add current-season request-planning coverage for cohort trend requests | add bootstrap service coverage for full-cohort trend materialization and empty trend payloads | verify supported trend queries return ok from an empty DB after bootstrap
## nightly_current_season_player_trends

- Title: Bootstrap current-season player trends for the derived cohort
- Module scope: current-season player trend materialization, trend-oriented nightly request planning, empty-payload success handling
- Interface contract: the bootstrap service writes current-season regular-season player trend rows for the full cohort | valid empty payloads are treated as successful nightly materialization | the public trend response contract remains unchanged
- Tests: add bootstrap service tests for current-season trend materialization | add ingest tests for empty trend payload success handling | add integration coverage that supported trend queries return ok after bootstrap

## nightly_backfill_2023_24_demo_season

- Title: Backfill 2023-24 demo-season support on miss
- Module scope: historical backfill-on-miss planning, 2023-24 nightly cache writes, skip-on-hit historical refresh policy
- Interface contract: 2023-24 regular-season ranking, team-defense, and trend shapes are backfilled on miss only | current-season refresh behavior remains unchanged | no new public route or warning contracts are introduced
- Tests: add bootstrap service tests for 2023-24 backfill-on-miss behavior | add regression coverage that current-season refresh policy is unchanged | add integration coverage that supported 2023-24 queries return ok after backfill
## nightly_bootstrap_e2e_and_docs_refresh

- Title: Lock end-to-end nightly bootstrap coverage and refresh docs
- Module scope: empty-DB integration coverage, cross-day snapshot regression coverage, runtime and bootstrap documentation
- Interface contract: an empty DB returns the existing nightly coverage gap before bootstrap | supported current routes return ok after bootstrap | docs and planning mirrors match the shipped runtime and nightly bootstrap workflow
- Tests: add empty-DB integration tests for before-and-after bootstrap behavior | add cross-day snapshot reuse regression coverage | rerun the full repo verification surface after doc updates

- Local validation loop for the `nightly-ingest` branch is now explicit: run targeted nightly tests first (`bootstrap-service`, `nightly-bootstrap.e2e`, `nightly-cache-coverage`), then manually verify the dev app by observing `nightly_data_unavailable` before `bun run nightly:bootstrap -- --slate-date YYYY-MM-DD` and `ok` responses after bootstrap on both `/api/query` and `/api/stats/query`.
- Added an offline local-dev escape hatch for nightly ingest: `bun run nightly:bootstrap -- --fixture-data --slate-date YYYY-MM-DD` now materializes the same supported runtime surface from checked-in fixtures, so local branch verification is no longer blocked when `stats.nba.com` is unreachable from the current network.
- Root cause of the persistent local `coverage_gap` after a successful fixture bootstrap was runtime mismatch, not cache shape: the app’s `vite` scripts were launching under Node in dev/build/preview, so `bun:sqlite` failed to load and the server silently used the in-memory store. Switching those scripts to `bun --bun vite ...` restored shared on-disk cache visibility between the bootstrap CLI and the running app.
- Live NBA fetches now support an explicit project proxy env var, `HOOP_HUB_NBA_PROXY_URL`, with fallback to standard `HTTPS_PROXY` / `HTTP_PROXY`. This mirrors the practical escape hatch used by `nba_api`: browser-like headers plus optional proxy routing when the current network path to `stats.nba.com` is bad.
- The repo-local `.data/hoop-hub.sqlite` default proved unstable under the full live nightly workload in this worktree. The default persistent DB path now moves to a per-worktree location under `~/.hoop-hub/data/<hash>/hoop-hub.sqlite`, while `HOOP_HUB_DB_PATH` remains the explicit override for custom paths.
- Fresh live bootstrap throughput is constrained by the per-player materialization surface, not by run-finalization bookkeeping. The nightly comparison/trend cohort is now explicitly bounded to the top active players by minutes plus a small curated allowlist for supported named-player queries, which keeps first-run bootstrap size finite and preserves support for players like Curry, Lillard, Jokic, and Achiuwa.
- On April 2, 2026 local live validation still remained blocked by `stats.nba.com` timing out from this machine, even when reproduced directly via the project’s Node helper, plain `node:https`, and a fresh `nba_api` install. Treat live bootstrap verification as network/upstream dependent; do not claim merge-readiness on live ingest without an actually successful clean bootstrap on the target network.
- Proxy support now reaches the real live transport path, not just the old Bun fetch path. `HOOP_HUB_NBA_PROXY_URL`/`HTTPS_PROXY`/`HTTP_PROXY` can be full proxy URLs or raw `host:port:user:pass` entries, and newline-delimited proxy lists are normalized and tried in order through the Node CONNECT tunnel helper.
- Nightly bootstrap now persists explicit per-request progress in `nightly_run_requests` keyed by slate date and request key. The bootstrap loop no longer infers resumability only from raw cache presence: rows track phase, status, attempt count, last error, and whether a request was satisfied from cache, so same-slate reruns can pick up failed work without re-fetching already-succeeded requests.
- The live bootstrap path now owns a long-lived Node fetch worker for the duration of a CLI run instead of spawning a new Node subprocess per request. A local integration test confirmed direct keep-alive socket reuse, and real repeated probes against `stats.nba.com` showed the practical effect on this network: after the first successful response, repeated same-session requests to the same endpoint dropped from multi-second cold calls to roughly 50ms warm hits.
- Endpoint-aware pacing is now phase-specific rather than one global concurrency knob: league-wide requests stay serial and gently paced, while comparison/trend/historical queues run at lower bounded concurrency with inter-request delays. This keeps the warm connection alive while avoiding the old bursty fan-out that wasted retries on cold sockets.
- A clean live bootstrap on a temp DB no longer dies at the first two league-wide endpoints. Mid-run inspection on April 3, 2026 showed the new queue progressing with dozens of succeeded rows and only the `playercareerstats` backlog left in flight, which is materially better than the previous hard-fail-at-start behavior even though end-to-end completion still depends on upstream stability.
- Live bootstrap reliability is now handled at the CLI boundary instead of by adding another retry layer inside the service. When a live pass ends `partial`, the CLI reruns the same slate with a fresh Node session until the run completes or stops making progress. The CLI also raises the live bootstrap default timeout to 15s when the user has not explicitly configured one.
- April 3, 2026 live validation on the persisted temp DB confirmed the simpler convergence story on this network. Re-running a previously partial slate with 12 outstanding failures recovered 11 of them in the first resumed pass, and the next same-slate rerun completed with `235` requests materialized and `0` failures.
- Nightly run bookkeeping now records a real completion timestamp instead of echoing the run start time into `completedAt`, so long-running live passes no longer look instantaneous in persisted diagnostics.
- Workspace bootstrap now seeds fixture-backed nightly data from `scripts/setup-workspace.sh`, so a fresh worktree starts with a usable local supported-query surface instead of immediate `nightly_data_unavailable` gaps.
- A dedicated `scripts/bootstrap-live-data.sh` helper now deletes the current workspace DB and reruns the live nightly bootstrap for a chosen slate date, keeping fixture-seeded local setup and real-data refresh paths separate.
