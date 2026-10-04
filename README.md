# Hoop Hub

AI-powered NBA natural-language search engine.

Hoop Hub is a single SvelteKit app built and developed with Bun, with Node HTTP and built-in SQLite for production. It answers grounded NBA stats questions through a dynamic tool-loop agent and a structured semantic stats route, backed by official NBA endpoint retrieval, caching, and owned research traces.

## Current Scope

- Primary structured route: `POST /api/stats/query`
- Primary natural-language route: `POST /api/query`, now backed by a dynamic OpenAI tool-loop agent.
- Trace route: `GET /api/query-trace/:traceId`
- `/api/query` can iteratively resolve players/teams, call cataloged NBA Stats endpoints live-first, reuse SQLite raw endpoint cache rows, and return grounded prose plus artifact specs.
- Named-player research questions such as “Tatum FG% when guarded by Scottie Barnes” use NBA Advanced Stats tracking-derived matchup data with role, evidence, and sample-size grounding.
- Defender leaderboard questions such as “Who does Scottie defend best?” rank the full tracked matchup population server-side with explicit minimum attempts/possessions so tiny samples cannot win by default.
- Supported semantic query families:
  - player and team season lookups
  - player rankings
  - player trends
  - player win/loss and home/away splits
  - player comparisons
  - team defensive rankings
  - team standings, schedules, and recent results
- Player resolution uses the shared seeded player-directory snapshot and curated aliases.
- Semantic query execution reads stored endpoint payloads only. An empty DB returns typed `nightly_data_unavailable` coverage gaps until nightly bootstrap materializes the supported runtime cache.
- Dynamic agent endpoint calls are live-first with SQLite caching. Set `HOOP_HUB_NBA_PROXY_URL` on networks where direct `stats.nba.com` access is blocked.
- Nightly reads reuse the latest stored snapshot at or before the query date, so prior-day materializations remain readable on later days.
- The legacy closed planner and semantic executor modules remain in the tree for compatibility and direct tests, but they are no longer the default `/api/query` runtime.

Detailed implementation context for future agents lives in [agents/current-state.md](agents/current-state.md), [`.docs/PLAN.md`](.docs/PLAN.md), [`.docs/RELEASE_CHECKLIST.md`](.docs/RELEASE_CHECKLIST.md), and [agents/project-log.md](agents/project-log.md).

## TODO

- [x] Foundation: app scaffold, contracts, health route
- [x] Planning groundwork: normalization, metrics, validation
- [x] Official NBA endpoint adapters + SQLite cache
- [x] Structured semantic execution for the initial query families
- [x] Seeded player-directory resolution + canonical semantic traces
- [x] Dynamic `/api/query` agent with cataloged NBA Stats tool calls and dynamic trace payloads
- [ ] Consolidate legacy closed-planner compatibility once dynamic-agent coverage is broad enough
- [x] Bridge the dynamic agent to the typed semantic executor and add first-class win/loss plus home/away player splits
- [x] Add resumable nightly bootstrap/materialization and stored-data-first structured reads
- [x] Schedule nightly bootstrap and add freshness/integrity auditing
- [ ] Add historical backfill, anomaly policy, indexed shot/event data, alert routing, and server-grade production storage
- [x] Add grounded derived/computed metric execution (`aggregate_endpoint_rows` filters/groups/aggregates full result sets server-side)
- [x] Add richer visualization artifacts (line, bar, and half-court shot chart components render agent artifacts in the UI)
- [x] Add bounded server-session grounding, exact shot refinements and canonical season comparisons
- [x] Persist private research across server restarts, with grounded follow-ups and multi-player trends
- [x] Add the dynamic-agent evaluation harness and performance gates
- [x] Clip retrieval and playlist output (`find_video_clips` over `videodetailsasset` + sequential playlist player in the UI)
- [x] Exact custom-shot playlists (`shotchartdetail` event filters joined to playable clips by game/event id)
- [x] Tracking-derived offensive-player versus named-defender matchup stats with grounded tables and small-sample labeling
- [x] Sample-qualified defender matchup leaderboards across shooting, volume, possession, scoring, assist, and turnover metrics
- [x] Expand the deterministic eval matrix, track model usage/cost inputs, and run a scheduled dynamic-agent live canary
- [ ] Retire legacy planner/orchestrator compatibility code
- [x] Prepare invite-only Docker deployment, authentication, ownership, quotas, feedback and backup/restore
- [ ] Select the host, verify hosted model/data/media flows, and expand SLOs and storage/workers as measured demand grows

## Local Setup

### Requirements

- Node `22.19.0+` (see [`.nvmrc`](.nvmrc))
- Bun

### Install + Run

```bash
cd apps/web
bun install
bun run dev
```

Bootstrap the supported nightly runtime cache from an empty DB:

```bash
cd apps/web
bun run nightly:bootstrap -- --slate-date 2026-04-01
```

When live access to `stats.nba.com` is unavailable, bootstrap the same supported runtime surface from checked-in fixtures for local verification:

```bash
cd apps/web
bun run nightly:bootstrap -- --fixture-data --slate-date 2026-04-01
```

The bootstrap path writes authoritative nightly rows for the current-season supported query surface, including league-wide rankings, team defensive rankings, the derived player comparison cohort, current-season player trends, and supported demo-season backfill rows when missing.

By default, persisted nightly data now lives in a per-worktree SQLite file under `~/.hoop-hub/data/<hash>/hoop-hub.sqlite`. Override it with `HOOP_HUB_DB_PATH` when you need a custom location.

Repo helpers:

```bash
./scripts/run-all.sh
./scripts/setup-workspace.sh
./scripts/bootstrap-live-data.sh 2026-04-01
./scripts/teardown-workspace.sh
```

`./scripts/setup-workspace.sh` now installs dependencies, copies matching repo env files such as `.env` and `apps/web/.env` from `SUPERSET_ROOT_PATH` when available, otherwise seeds missing env files from local examples, and bootstraps fixture-backed nightly data for the current date so new workspaces can answer supported demo queries immediately.

`./scripts/bootstrap-live-data.sh YYYY-MM-DD` deletes the current workspace DB if it exists and then runs a fresh live nightly bootstrap for that slate date.

### Verify

```bash
cd apps/web
bun run check
bun run test
bun run build
bun run eval
bun run eval:custom-shots
```

## Dynamic-Agent Evaluation

The default evaluation suite is deterministic and offline. It replays explicit model tool decisions through the real dynamic-agent service and uses endpoint fixtures for numeric, artifact, warning, clip-intent, and response-hygiene assertions:

```bash
cd apps/web
bun run eval
```

Paid evaluations have two separate modes. Set `HOOP_HUB_EVAL_BUDGET_USD` and current input/output USD rates per million in `apps/web/.env` first (see `.env.example`). The budget is checked before every model call with a conservative token reservation, 8192 output-token limit and no automatic transport retries. Requests are paced (default 4 seconds between starts); explicit token-rate errors get at most two bounded retries. Billing/quota failures stop immediately. Cache-read and cache-write token usage is recorded; optional rates improve estimates. CI's live workflow uses repository variables with the same names.

`eval:model` lets the actual model choose tools against strictly scoped synthetic fixtures and a fixed calendar. It rejects unrecorded player/season/filter populations and never reads live NBA data. These tests establish computation and interpretation behavior, not independently verified real NBA gold answers:

```bash
cd apps/web
bun run eval:model -- --repetitions 1
```

`eval:live` uses the configured model plus NBA cache/live data. It checks availability and evidence consistency without applying synthetic fixture numbers to real sports results. It is excluded from ordinary tests and CI:

```bash
cd apps/web
bun run eval:live
```

The made-three case defaults to 20 live repetitions because its intent broadening was nondeterministic. Use focused filters or a repetition override for smaller smoke runs:

```bash
bun run eval -- --case scottie-made-threes-vs-boston
bun run eval:live -- --tag clips --repetitions 1
bun run eval:live -- --case scottie-made-threes-vs-boston --repetitions 20
```

Each invocation exits nonzero when a required gate fails and writes redacted `results.jsonl` plus `summary.md` under `apps/web/eval-results/<timestamp>-<mode>/` by default. Use `--output <directory>` to choose another report location, and `--help` for all filters.

Local evals certify deterministic contracts; model evals test real interpretation against synthetic gold data; live evals check NBA retrieval and evidence consistency. A passing live consistency check alone does not prove every answer number correct. Playlist contents are checked structurally here, while actual video playback and auto-advance still require browser QA.

## Custom Shot Video Search

`find_video_clips` has two execution paths:

- Standard events (`made_three`, `made_field_goal`, assists, blocks, steals, rebounds, and turnovers) use their direct NBA video context measure. For example, `made_three` remains `FG3M` and `made_field_goal` remains `FGM`.
- `custom_shot` requests use a semantic filter contract for make/miss result, 2- or 3-point value, zone, zone area, action family, period, distance, opponent, season, game, and date constraints. The server fetches the uncapped shot log, filters it exactly, then joins playable videos on `(GAME_ID, GAME_EVENT_ID)`.

Custom playlists are ordered chronologically by game date, game id, and event id. The 40-clip product cap is applied only after the exact join. Tool grounding reports matching shot events, joined clips, missing videos, invalid join keys, whether the playlist was capped, joined event ids, and canonical applied filters. A partial join produces one concise video-availability warning; a complete join produces none. An explicit-cue guard rejects a tool call before retrieval when it drops or contradicts an unambiguous requested filter (for example, mid-range, left/right corner, pull-up, step-back, driving layup, make/miss, 2/3-point value, or quarter), allowing the model to retry instead of silently broadening the playlist.

The action families cover the values observed in live shot logs, including pull-ups, step-backs, layups, dunks, hooks, floaters, fadeaways, turnarounds, putbacks, tips, alley-oops, cutting/running actions, bank shots, and finger rolls. Zone mappings cover the restricted area, non-restricted paint, mid-range, both corners, above-the-break threes, and backcourt. Unsupported terminology is rejected rather than broadened. Named-defender clip filtering remains unavailable: the agent must ask before substituting the defender's team. Named-player matchup statistics are supported separately through tracking-derived aggregate data. Browser autoplay policies can still require the user to press the native video play control; the playlist surfaces that fallback without treating it as missing NBA video.

`bun run eval:custom-shots` runs deterministic custom-video contract cases, including paraphrases, empty combinations, and partial joins. Live model, NBA data, and playback checks remain separate release gates because they require credentials and network/video availability.

The full deterministic, live, and browser release gate is documented in [`.docs/RELEASE_CHECKLIST.md`](.docs/RELEASE_CHECKLIST.md).


## Interactive Research

Shot charts include event inspection, makes/misses controls, attempt-density and FG% heatmaps. Percentage bins disclose their sample sizes and shade small samples. Tables support stable numeric sorting, search and pagination; line charts toggle series; bars support order changes. Keyboard controls accompany pointer inspection.

Available shot/video selection uses exact game and event IDs. The playlist shows matching, unavailable and capped counts, supports sequential playback, and surfaces browser/media errors. Shooting denominators use all attempts under the research filters, independently of which clips are available.

Raw leaderboards qualify and rank the full retrieved population before returning a limited selection. Trend arithmetic comes from server computation. Multiple players, seasons, and metrics retain separate verified populations; different metrics use separate charts, and comparisons include a canonical summary table. Missing or contradictory populations are disclosed rather than combined.

`POST /api/query` accepts `{ question, sessionId? }` and returns `sessionId`, `researchTurnId`, grounded follow-up suggestions, and effective scope when grounding succeeds. With `Accept: text/event-stream`, it emits current activity, elapsed time, cumulative verified artifacts, and a final result or typed error. Cancellation reaches model requests and NBA subprocesses. Independent tool calls run in bounded parallel batches and equivalent successful endpoint requests share one retrieval within an answer.

The UI retains the session for follow-ups and starts fresh with **New research**. Narrow edits such as “Show only the misses,” “Only fourth quarter,” and “Compare that with 2023-24” replay validated requests server-side. General follow-ups use bounded context and require broader model evaluation. SQLite persists both validated grounding and rendered history across restarts; the default retention is 90 days, configurable with `HOOP_HUB_RESEARCH_RETENTION_DAYS`. Each account is bounded to 100 sessions, 50 turns per session, 1 MiB per displayed answer and 16 MiB of saved-answer payloads, with questions and bounded grounding stored separately. Expired IDs return 409. Saved research can be reopened, renamed, or deleted through the sidebar and `/api/research` routes.

Implicit “this season” resolves to the latest season whose published opening tip has occurred. Explicit future seasons stay explicit. Opening evidence is centralized in `src/lib/server/season-intent.ts`; update its official NBA dates when a new season is announced.

## Invite beta

Use [`.docs/BETA_DEPLOYMENT.md`](.docs/BETA_DEPLOYMENT.md) and [`deploy/beta.env.example`](deploy/beta.env.example) for the portable Docker/Compose setup, invitations, conservative model budgets, health/readiness, feedback, backups and recovery. The deployment runs one app process with persistent volumes and an optional Caddy HTTPS proxy. Local development remains available on loopback; production research is private to invited accounts.

The package is prepared locally. Sharing still requires a host/domain, configured model credentials/prices, applicable source display permission and hosted model/NBA/video acceptance. No paid specialist provider is required for the initial pilot.

Saved playlists offer **Export compiled clips**. The server validates each selected game/event against the saved result, downloads only allowed NBA media, normalizes it with `ffmpeg`/`ffprobe`, and produces one MP4. Missing clips are listed as omissions. Install both binaries or set `HOOP_HUB_FFMPEG_PATH` and `HOOP_HUB_FFPROBE_PATH`; `HOOP_HUB_EXPORT_DIR` optionally overrides storage. Exports have one worker, a ten-job queue, a 40-clip limit, bounded bytes/time, and 24-hour download retention. This local queue does not provide distributed worker coordination.

The synthetic interaction lab is at `/dev/charts`. Use live research for actual NBA findings.

## CI

- GitHub Actions workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
- Default CI runs `bun ci`, `bun run check`, `bun run test`, and `bun run build` in `apps/web`
