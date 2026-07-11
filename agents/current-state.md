# Current State

This file is the short source of truth for future agents. Use it before relying on older roadmap language or legacy planner code.

## Shipped Engine State

- The production natural-language runtime is `POST /api/query` in front of the dynamic tool-loop agent in `apps/web/src/lib/server/agent/`.
- `POST /api/stats/query` is the primary structured tool contract.
- `POST /api/query` is the primary natural-language route and is no longer closed to the legacy planner's supported shapes.
- `GET /api/query-trace/:traceId` returns semantic trace payloads for structured runs and `runtime: "dynamic_agent"` trace payloads for agent runs, including tool calls, cache/freshness data, warnings, and source calls.
- Supported semantic query families today:
  - player and team season lookups
  - player rankings
  - player trends
  - player win/loss and home/away splits
  - player comparisons
  - team defensive rankings
  - team standings
  - team schedule and recent-result queries
- The dynamic agent exposes the semantic runtime as `execute_semantic_query` using the published capability contract. Successful table artifacts are replaced with canonical semantic rows before returning to the UI.
- Structured responses should be treated as the core artifact. Summaries are secondary to canonical rows.
- The legacy planner remains in the tree for compatibility tests and direct orchestrator usage, but it is no longer the default `/api/query` runtime.

## Data and Resolution State

- Semantic query execution now reads stored endpoint payloads only; it no longer exposes request-level live fallback.
- Dynamic agent endpoint calls use the cataloged NBA Stats endpoint client live-first with SQLite caching. `HOOP_HUB_NBA_PROXY_URL` is needed on networks where direct `stats.nba.com` requests are blocked.
- Resumable finalized nightly ingestion is implemented through `nightly:bootstrap`; missing stored endpoint data returns typed `coverage_gap` responses.
- `nightly:audit` verifies run completion, request/cache agreement, payload JSON/checksum integrity, expiry, and finalized/provisional/stale/unavailable freshness. `.github/workflows/nightly-materialization.yml` schedules live bootstrap plus audit and retains the database and health report as artifacts.
- Player resolution now goes through the shared seeded player-directory snapshot in `apps/web/src/lib/server/players/player-directory.ts`.
- Curated aliases sit on top of canonical player identity; do not reintroduce ad hoc player name maps in new execution code.
- Nightly reads use the latest stored snapshot at or before the query date. Stale non-final past scoreboards are refreshed during bootstrap instead of becoming permanently authoritative.

## Trace and Session State

- Traces should expose canonicalized execution state through `resolvedQuery`, not raw caller input when normalization/resolution changed it.
- The production natural-language route no longer uses `sessionId`; the UI should not imply real conversational memory.

## Legacy Boundary

- The repo still contains the old planner/mock-engine path for compatibility coverage.
- Do not add new product behavior to the legacy mock planner/query-engine unless the task is explicitly about compatibility tests or migration.
- Future engine work should consolidate around one semantic runtime instead of extending both paths in parallel.

## Near-Term Gaps

- historical backfill, anomaly policy, shot/event indexes, and production alert routing
- broader dynamic-agent endpoint coverage, eval corpus growth, and model prompt hardening
- starter/bench, playoffs, clutch, opponent, lineup, and on/off typed execution
- persisted session grounding
- single-file clip compilation/export (ffmpeg); the shipped playlist player auto-advances through clips instead

Clip retrieval now has direct-event and exact custom-shot paths. Standard event intents still map straight to `videodetailsasset` context measures (`made_three` -> `FG3M`, `made_field_goal` -> `FGM`, plus direct assist/block/steal/rebound/turnover measures). `custom_shot` fetches the full `shotchartdetail` log, applies canonical result/value/zone/zone-area/action-family/period/distance filters, then makes at most one broad video request and joins only on `(GAME_ID, GAME_EVENT_ID)`. The 40-clip cap is applied after joining, and tool data exposes matching/joined/missing counts, invalid keys, cap state, returned event ids, and applied filters. `src/lib/server/agent/custom-shot-clips.ts` owns the deterministic filter/join logic; `video-clips.ts` can parse an uncapped feed for this path.

Custom video artifacts are reconciled from successful tool output rather than trusted model-authored clip lists. Complete joins do not warn; partial joins produce one deterministic product warning. Missing/malformed ids and unplayable or absent videos remain missing instead of admitting unrelated feed events. The explicit-cue guard also rejects pre-fetch tool calls that omit or contradict clear mid-range, corner, action, result, shot-value, or quarter language, so the model can retry with the complete canonical intent. The observed action vocabulary includes variants such as `Pullup Jump shot`, `Running Pull-Up Jump Shot`, `Step Back Jump shot`, driving/cutting/running layups and dunks, hooks, floaters, fadeaways, turnarounds, putbacks, tips, alley-oops, banks, and finger rolls. Novel action terminology outside the semantic families is currently unsupported and must not be silently broadened.

Named-player matchup statistics are now supported through the official `leagueseasonmatchups` feed used by NBA.com's head-to-head page. The `analyze_player_matchup` tool preserves offensive/defensive player roles and returns games, matchup minutes, partial possessions, points, FGM/FGA/FG%, 3PM/3PA/3P%, assists, and turnovers. Results are labeled `tracking_derived` with high confidence and a deterministic small-sample note when games, FGA, or matchup possessions are thin.

Defender leaderboards use `rank_defender_matchups`. The server fetches every tracked offensive matchup for one defender, applies minimum games/FGA/3PA/partial-possession thresholds, ranks deterministically, caps only after filtering/sorting, and reconciles a grounded ranking table. Supported ranking fields are `fgPct`, `fg3Pct`, `partialPossessions`, `points`, `fga`, `fg3a`, `assists`, and `turnovers`. “Defended best” defaults to lowest FG% with at least 10 FGA and 25 partial possessions; three-point defense defaults to at least 5 3PA; unbounded asks default to five results.

Clip opponent filtering remains team-level because the season matchup feed has no event IDs. The existing video guard still rejects a resolved defender-to-team substitution unless the user first approves that broader scope. Browser autoplay policies may require the native play control after `Play all`; this is distinct from missing video. `bun run eval:custom-shots` runs the deterministic custom-video contract suite; live model/data/playback checks remain separate release gates.

Derived/computed metrics now run through the agent's `aggregate_endpoint_rows` tool (server-side filter/group/aggregate over full result sets), and line/bar/shot-chart artifacts render as real chart components (`src/lib/components/charts/`, QA page at `/dev/charts`). The player directory re-seeds stored DBs whenever the checked-in snapshot version changes.

## Verification Surface

- Default repo verification remains:
  - `cd apps/web && bun run check`
  - `cd apps/web && bun run test`
  - `cd apps/web && bun run build`
  - `cd apps/web && bun run eval`
- Fixture-backed semantic tests are the main guardrail for default CI.
- Live integration smoke coverage should stay isolated from default PR gating.
- Dynamic-agent model evaluation now has two explicit modes:
  - `cd apps/web && bun run eval` replays data-defined model turns against deterministic endpoint fixtures with no OpenAI or NBA network calls.
  - `cd apps/web && bun run eval:live` uses the configured OpenAI model and normal NBA cache/live endpoint client; it is excluded from `bun run test` and ordinary CI.
- Eval cases, invariants, fixture adapters, runner, and redacted JSONL/Markdown reports live in `apps/web/src/lib/server/eval/`; the thin CLI entry point is `apps/web/scripts/run-evals.ts`.
- Local eval runs every prompt variant at least once and currently covers 24 deterministic prompt-level runs; the custom-shot suite adds seven deterministic contract cases.
- Dynamic-agent traces record model calls and input/output/total tokens. Eval reports estimate cost only when `HOOP_HUB_EVAL_INPUT_COST_PER_MILLION` and `HOOP_HUB_EVAL_OUTPUT_COST_PER_MILLION` are configured, avoiding stale hardcoded model pricing.
- Focus runs accept `--case`, `--tag`, and `--repetitions`. The made-three stochastic gate defaults to 20 live repetitions, while `--repetitions 1` is suitable for a credential smoke.
- Current required eval coverage includes pull-up mid-range grounding and shot-chart reconciliation, latest-ten trend chronology, top-five truncation hygiene, conditional records, win/loss splits, typed semantic lookup/split grounding, tracking-derived named-player matchup stats, sample-qualified defender rankings, stable made-three clip intent/FG3M mapping, named-defender clip fallback rejection, endpoint failure behavior, and global product-response diagnostic hygiene.
- The server eval validates playlist contents and contracts, not browser media playback or auto-advance; keep real-browser playlist QA as a separate merge-readiness check.
- `.github/workflows/live-smoke.yml` runs the dynamic-agent live eval on a daily schedule and manual dispatch, with redacted reports uploaded as workflow artifacts.
- `.github/workflows/nightly-materialization.yml` runs bootstrap plus health audit on a schedule and manual dispatch; an unhealthy audit fails the workflow.
- The complete merge/release gate is documented in `.docs/RELEASE_CHECKLIST.md`.
