# Hoop Hub Web App

The SvelteKit application containing the UI, API routes, dynamic agent, structured semantic runtime, data adapters, evaluation harness, and nightly bootstrap. Bun owns development/builds/operator commands; production uses Node 22.19+ HTTP and built-in SQLite.

Start with the [project overview](../../README.md), [development guide](../../docs/development.md), [architecture](../../docs/architecture.md), or [engineering evidence](../../docs/engineering-evidence.md).

For a preview without credentials, run `bun run demo` and open `http://127.0.0.1:4173/dev/research`. This uses synthetic fixtures and a dedicated `.data/demo.sqlite` database.

## Commands

```bash
bun run dev
bun run check:repo
bun run check
bun run check:endpoint-catalog-contracts
bun run test
bun run eval
bun run eval:custom-shots
bun run eval:model -- --repetitions 1
bun run eval:live -- --repetitions 1
bun run nightly:bootstrap -- --slate-date 2026-04-01
bun run nightly:bootstrap -- --fixture-data --slate-date 2026-04-01
bun run nightly:audit -- --slate-date 2026-04-01
bun run build
bun run beta:smoke
bun run beta:container-smoke
```

Default tests and local evals are deterministic. The endpoint catalog check fetches upstream documentation and requires network access. Model eval uses the configured OpenAI model against strictly scoped synthetic fixtures. Live eval additionally requires NBA connectivity. Both paid modes are separate from ordinary CI.

### Research versus visual preview

For normal research at `/`, enable live retrieval and keep fixture seeding off:

```bash
HOOP_HUB_ENABLE_LIVE_NBA=1 HOOP_HUB_ENABLE_LIVE_PBPSTATS=1 HOOP_HUB_UI_FIXTURES=0 bun run dev
```

`/dev/research` is an opt-in synthetic UI lab. Run it with an explicit disposable `HOOP_HUB_DB_PATH` and `HOOP_HUB_UI_FIXTURES=1`. Keep its database separate from real research: the lab seeds synthetic endpoint caches. With `HOOP_HUB_ENABLE_LIVE_NBA=0`, uncached real questions return a coverage gap because no NBA lookup is attempted.

Production builds package the NBA subprocess transports as private server assets and verify that both launch after relocating the server output. The NBA transport requires a Node runtime with child-process support.

## Environment

- `OPENAI_API_KEY` — required by the dynamic natural-language agent and live eval.
- `OPENAI_AGENT_MODEL` — required dynamic-agent model selection (`OPENAI_PLANNER_MODEL` remains a compatibility fallback).
- `OPENAI_PLANNER_MODEL` and `OPENAI_ANSWER_RENDERER_MODEL` — compatibility planner/renderer configuration; they are not the primary product runtime.
- `HOOP_HUB_NBA_TIMEOUT_MS` — optional NBA request timeout.
- `HOOP_HUB_NBA_PROXY_URL` — optional preferred NBA proxy; standard `HTTPS_PROXY` and `HTTP_PROXY` are also supported.
- `HOOP_HUB_DB_PATH` — optional SQLite path override. The default is a per-worktree file under `~/.hoop-hub/data/<hash>/hoop-hub.sqlite`.
- `HOOP_HUB_EVAL_BUDGET_USD` — required shared allowance for each paid eval run; calls reserve a conservative token allowance before execution.
- `HOOP_HUB_EVAL_INPUT_COST_PER_MILLION` and `HOOP_HUB_EVAL_OUTPUT_COST_PER_MILLION` — required current model prices used to enforce the eval budget and estimate cost.
- `HOOP_HUB_EVAL_CACHED_INPUT_COST_PER_MILLION` and `HOOP_HUB_EVAL_CACHE_WRITE_COST_PER_MILLION` — optional prices for provider-reported cache usage.

## API routes

- `GET /api/health`
- `GET /api/ready` — public minimal deployment readiness.
- `POST /api/query` — primary natural-language dynamic-agent route.
- `POST /api/stats/query` — structured semantic query route.
- `GET /api/stats/capabilities` — structured runtime capabilities.
- `GET /api/query-trace/:traceId` — dynamic or structured execution trace.
- `GET /api/research` and owned session routes — private saved research.
- `GET /api/usage` — the signed-in account's daily allowance.
- `POST /api/feedback` — report a problem on an owned saved answer.

Invite mode authenticates every research, trace and export route. Credential endpoints share login throttles and same-origin request checks. See [../../.docs/BETA_DEPLOYMENT.md](../../.docs/BETA_DEPLOYMENT.md) for production start/configuration and operator commands; `beta:container-smoke` needs the locally built `hoop-hub-beta:local` image.

## Runtime map

- `src/lib/server/agent/` owns the dynamic tool loop, tracking-derived player matchups and defender leaderboards, exact custom-shot joins, endpoint aggregation, time-series analysis, and video retrieval.
- `src/lib/server/semantic/` owns the structured stored-data runtime and capabilities, including player win/loss and home/away splits.
- `src/lib/server/data/` owns cataloged NBA retrieval, caching, storage, and source-call metadata.
- `src/lib/server/beta/` owns identity, admission, persistent quotas, feedback, readiness and database snapshots.
- `src/lib/server/nightly/` owns resumable bootstrap/materialization.
- `nightly:audit` validates run completion, request/cache agreement, JSON/checksum integrity, and finalized/provisional/stale/unavailable freshness.
- `src/lib/server/players/` and `src/lib/server/teams/` own canonical identity resolution.
- `src/lib/server/eval/` owns deterministic, model-fixture, and live agent cases, assertions, budget enforcement, reports, and runner logic.
- `src/lib/components/charts/` and `src/lib/components/video/` render grounded artifacts.
- Planner, query-orchestrator, answer-renderer, and mock modules are compatibility surfaces; new product behavior should not be added there.

Structured semantic execution reads stored materialized payloads. The dynamic agent uses the typed semantic tool for supported shapes and reconciles returned tables from canonical executor rows. Named-player matchup stats and defender leaderboards use the official tracking-derived season-matchup feed; pair rows, ranking order, sample floors, evidence, and tables are reconciled server-side. Other dynamic-agent endpoint calls use the cataloged NBA client live-first with cache reuse. Custom-shot video searches filter the shot log and join exact game/event IDs before applying the playlist cap.

See [../../agents/current-state.md](../../agents/current-state.md) for current architecture, [../../.docs/PLAN.md](../../.docs/PLAN.md) for priorities, and [../../.docs/RELEASE_CHECKLIST.md](../../.docs/RELEASE_CHECKLIST.md) for release gates.

### Temporary source failures

PBP Stats retrieval makes at most two attempts within a shared 30-second budget, including queue time and backoff. Each attempt has a 20-second limit. Only connection failures, timeouts, HTTP 408/429 and temporary server errors (500/502/503/504) retry. `Retry-After` is respected within the remaining budget; cancellation stops both requests and waits. Invalid requests and malformed data are not retried.

If retrieval still fails temporarily, the saved answer retains recovery intent and offers **Retry question**. Unsupported scopes retain their existing limitations. Available partial evidence stays visible, and older cached snapshots remain explicitly stale.
