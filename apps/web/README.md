# Hoop Hub Web App

The Bun + SvelteKit application containing the UI, API routes, dynamic agent, structured semantic runtime, data adapters, evaluation harness, and nightly bootstrap.

## Commands

```bash
bun run dev
bun run check
bun run check:endpoint-catalog-contracts
bun run test
bun run eval
bun run eval:custom-shots
bun run eval:live -- --repetitions 1
bun run nightly:bootstrap -- --slate-date 2026-04-01
bun run nightly:bootstrap -- --fixture-data --slate-date 2026-04-01
bun run nightly:audit -- --slate-date 2026-04-01
bun run build
```

Default tests and local evals are deterministic. Live eval requires configured OpenAI credentials and NBA connectivity and is intentionally separate from ordinary CI.

## Environment

- `OPENAI_API_KEY` — required by the dynamic natural-language agent and live eval.
- `OPENAI_AGENT_MODEL` — optional dynamic-agent model override.
- `OPENAI_PLANNER_MODEL` and `OPENAI_ANSWER_RENDERER_MODEL` — compatibility planner/renderer configuration; they are not the primary product runtime.
- `HOOP_HUB_NBA_TIMEOUT_MS` — optional NBA request timeout.
- `HOOP_HUB_NBA_PROXY_URL` — optional preferred NBA proxy; standard `HTTPS_PROXY` and `HTTP_PROXY` are also supported.
- `HOOP_HUB_DB_PATH` — optional SQLite path override. The default is a per-worktree file under `~/.hoop-hub/data/<hash>/hoop-hub.sqlite`.
- `HOOP_HUB_EVAL_INPUT_COST_PER_MILLION` and `HOOP_HUB_EVAL_OUTPUT_COST_PER_MILLION` — optional pricing inputs used to estimate live eval cost without hardcoding model prices.

## Public routes

- `GET /api/health`
- `POST /api/query` — primary natural-language dynamic-agent route.
- `POST /api/stats/query` — structured semantic query route.
- `GET /api/stats/capabilities` — structured runtime capabilities.
- `GET /api/query-trace/:traceId` — dynamic or structured execution trace.

## Runtime map

- `src/lib/server/agent/` owns the dynamic tool loop, tracking-derived player matchups and defender leaderboards, exact custom-shot joins, endpoint aggregation, time-series analysis, and video retrieval.
- `src/lib/server/semantic/` owns the structured stored-data runtime and capabilities, including player win/loss and home/away splits.
- `src/lib/server/data/` owns cataloged NBA retrieval, caching, storage, and source-call metadata.
- `src/lib/server/nightly/` owns resumable bootstrap/materialization.
- `nightly:audit` validates run completion, request/cache agreement, JSON/checksum integrity, and finalized/provisional/stale/unavailable freshness.
- `src/lib/server/players/` and `src/lib/server/teams/` own canonical identity resolution.
- `src/lib/server/eval/` owns deterministic/live agent cases, assertions, reports, and runner logic.
- `src/lib/components/charts/` and `src/lib/components/video/` render grounded artifacts.
- Planner, query-orchestrator, answer-renderer, and mock modules are compatibility surfaces; new product behavior should not be added there.

Structured semantic execution reads stored materialized payloads. The dynamic agent uses the typed semantic tool for supported shapes and reconciles returned tables from canonical executor rows. Named-player matchup stats and defender leaderboards use the official tracking-derived season-matchup feed; pair rows, ranking order, sample floors, evidence, and tables are reconciled server-side. Other dynamic-agent endpoint calls use the cataloged NBA client live-first with cache reuse. Custom-shot video searches filter the shot log and join exact game/event IDs before applying the playlist cap.

See [../../agents/current-state.md](../../agents/current-state.md) for current architecture, [../../.docs/PLAN.md](../../.docs/PLAN.md) for priorities, and [../../.docs/RELEASE_CHECKLIST.md](../../.docs/RELEASE_CHECKLIST.md) for release gates.
