# NBA NL Search Engine POC Plan (Bun + SvelteKit, Local-First)

## Summary
Build a local-first, stats-grounded NBA natural-language search engine in thin vertical slices, starting with core stat Q&A (modern era coverage), then adding visualization, then play-by-play clip playlists.  
Architecture is a single Bun + SvelteKit app (server routes + UI), with on-demand official NBA endpoint retrieval, local caching in SQLite, analytical computation in DuckDB, and cloud LLM orchestration for query planning.

## Locked Decisions
- Product scope: stats-only contract in V1; unsupported non-groundable questions return explicit “unsupported” responses.
- First slice: core stat Q&A only.
- Data coverage: modern era NBA seasons (configurable start; default `1996-97`).
- Data strategy: on-demand retrieval + local cache.
- Source strategy: official NBA endpoints first.
- Runtime/UI: Bun + SvelteKit web chat.
- Service topology: single app with server routes.
- LLM: cloud model, local app hosting.
- Custom metrics: free-form user intent supported via restricted expression DSL compiled to SQL.
- Transparency UX: default clean chat, with a “Show steps” popup containing query/provenance/formulas.
- Visualization policy: model-driven selection (with strict schema validation and fallback).
- Clip support: Phase 2, ordered playlist output first (not stitched montage).
- Chat memory: session-scoped with citation re-grounding.
- Observability: structured logs + traces from day one.
- Quality/perf gates: >=90% grounded correctness on curated 100-query suite; p95 <= 6s target.
- Distribution: private/local POC initially.

## System Architecture (Decision-Complete)

### 1) Query Orchestration Pipeline
Request flow for `POST /api/chat/query`:
1. Normalize input + session context.
2. Entity resolution (player/team/game disambiguation).
3. LLM planner generates typed `QueryPlan` JSON.
4. Plan validator enforces schema + scope constraints.
5. Execution planner maps plan to:
- endpoint fetch operations
- cache hits/misses
- derived metric calculations
- optional visualization intent
6. Execute retrieval + compute.
7. Compose answer + citations + optional artifacts.
8. Persist trace for “Show steps” popup.

### 2) Data Layer
- SQLite (operational/cache metadata):
- request cache keys, TTLs, query traces, session context, benchmark logs.
- DuckDB (analytical execution):
- temporary normalized frames per query run.
- formula/aggregation execution.
- no raw season-wide warehouse in V1 (on-demand only).
- Caching:
- endpoint result cache key = `source + endpoint + normalized_params + season_or_range`.
- TTL tiers:
- high-volatility endpoints: shorter TTL
- stable boxscore aggregates: longer TTL
- stale-on-error fallback allowed with explicit stale marker in provenance.

### 3) Computation Engine (Restricted DSL)
- Free-form metric intent is translated into a safe DSL AST.
- Allowed:
- arithmetic ops, aggregations (`sum`, `avg`, `count`, ratios), filters over whitelisted fields.
- Disallowed:
- arbitrary function calls, file/network/system access, raw code eval.
- Compiler emits parameterized DuckDB SQL only.
- Every computed metric returns:
- formula string,
- resolved SQL fragment,
- source fields used.

### 4) Visualization Layer (Model-Driven + Guardrails)
- LLM proposes `VisualizationSpec` (typed JSON).
- Server validates against strict schema and data-shape checks.
- Supported V1 visuals:
- table, bar, line, scatter.
- V1.5:
- shot zone heatmap + half-court overlay.
- If invalid/low confidence/incompatible data:
- fallback to table + explanatory note.

### 5) Phase 2 Clip Retrieval Layer
- New endpoint `POST /api/clips/search`.
- Input: structured play filters (player/action/zone/time/game filters).
- Output: ordered playlist items with metadata (game, clock, play type, clip URL).
- No media stitching in Phase 2.
- Clip list can be embedded in chat response when query intent includes video request.

### 6) UI/UX
- SvelteKit chat interface with:
- answer panel,
- optional visualization panel,
- optional clip playlist panel (Phase 2),
- “Show steps” button -> popup with:
- normalized intent
- structured plan summary
- sources touched
- formulas/computations
- latency breakdown
- follow-up prompts carry session memory but always re-ground against fresh/valid cached data.

## Public APIs / Types

### `POST /api/chat/query`
Request:
```ts
type ChatQueryRequest = {
  sessionId: string;
  message: string;
  clientTs?: string;
};
```

Response:
```ts
type ChatQueryResponse = {
  answer: string;
  artifacts: {
    table?: { columns: string[]; rows: (string | number | null)[][] };
    visualization?: VisualizationSpec;
    clips?: ClipItem[]; // Phase 2
  };
  citations: Citation[];
  traceId: string; // used by Show Steps popup
  followups?: string[];
};
```

### `GET /api/query-trace/:traceId`
Returns plan + execution trace for popup:
```ts
type QueryTrace = {
  normalizedQuestion: string;
  queryPlan: QueryPlan;
  executedSources: Citation[];
  computations: ComputationTrace[];
  latencyMs: {
    planning: number;
    retrieval: number;
    compute: number;
    render: number;
    total: number;
  };
  cache: { hits: number; misses: number };
};
```

### `POST /api/clips/search` (Phase 2)
```ts
type ClipSearchRequest = {
  sessionId: string;
  filters: ClipFilterPlan;
};
type ClipSearchResponse = { clips: ClipItem[]; traceId: string };
```

## Repository Structure
- `/Users/agocharbhatia/Desktop/code/hoop-hub/apps/web` (SvelteKit UI + server routes)
- `/Users/agocharbhatia/Desktop/code/hoop-hub/packages/contracts` (zod/json schemas + shared TS types)
- `/Users/agocharbhatia/Desktop/code/hoop-hub/packages/query-engine` (planner, validator, execution planner)
- `/Users/agocharbhatia/Desktop/code/hoop-hub/packages/data-adapters` (NBA endpoint clients + cache adapters)
- `/Users/agocharbhatia/Desktop/code/hoop-hub/packages/compute` (DSL parser + DuckDB compiler)
- `/Users/agocharbhatia/Desktop/code/hoop-hub/packages/evals` (100-query benchmark harness)
- `/Users/agocharbhatia/Desktop/code/hoop-hub/tasks/todo.md` (milestone checklist + working notes)
- `/Users/agocharbhatia/Desktop/code/hoop-hub/tasks/lessons.md` (failure mode log + prevention rules)

## Milestones (Thin Slices)

1. Milestone 0: Bootstrap + contracts + task discipline
- Bun + SvelteKit app scaffold, Docker Compose, base schemas, logging scaffold.
- Create `tasks/todo.md` and `tasks/lessons.md` templates.
- Exit: app boots in Docker; `/api/health` + schema package wired.

2. Milestone 1: QueryPlan + entity resolution
- Build typed `QueryPlan` schema and resolver (player/team disambiguation).
- Add planner prompt + JSON validation.
- Exit: sample NL queries produce valid plans or explicit validation errors.

3. Milestone 2: Data adapters + cache
- Implement official endpoint client wrappers and SQLite cache with TTL policy.
- Exit: deterministic retrieval tests pass with cache hit/miss accounting.

4. Milestone 3: Compute DSL + DuckDB execution
- Implement restricted DSL parser -> AST -> parameterized DuckDB SQL.
- Exit: derived metric tests pass; unsafe expressions rejected.

5. Milestone 4: End-to-end answer composition + citations
- Wire planner + retrieval + compute + answer composer + trace storage.
- Add “Show steps” popup endpoint.
- Exit: 30 seed queries run end-to-end with provenance.

6. Milestone 5: Model-driven visualization
- Add `VisualizationSpec` generation + schema validation + fallback behavior.
- Render table/bar/line/scatter in chat.
- Exit: visualization compatibility tests and fallback tests pass.

7. Milestone 6: Benchmark + performance hardening
- Build curated 100-query eval suite and scoring harness.
- Tune caching/planning/execution until gates met.
- Exit: >=90% grounded correctness, p95 <= 6s on local benchmark conditions.

8. Milestone 7 (Phase 2): Clip playlist retrieval
- Add clip filter planner + retrieval endpoint + ordered playlist rendering.
- Exit: clip queries return correct filtered playlist with trace/citations.

## Test Cases and Scenarios

### Unit
- QueryPlan schema validation and coercion.
- Entity disambiguation (duplicate names, nicknames, typos).
- DSL parser safety (reject unsafe tokens/functions).
- SQL compiler correctness for arithmetic/aggregate/filter combos.
- Visualization spec validator + fallback selection.

### Integration
- Endpoint adapter + SQLite cache lifecycle (miss -> hit -> TTL expiry).
- Planner -> execution -> response pipeline with trace persistence.
- Session follow-up re-grounding behavior.
- “Show steps” popup trace retrieval consistency.

### End-to-End
- Curated 100-query benchmark across:
- player/game/team comparisons
- time filters (season split, last N games)
- derived metrics
- ambiguous entity prompts
- unsupported question handling
- Phase 2: clip playlist query flows.

### Acceptance Gates
- Correctness: >=90% grounded on curated benchmark.
- Performance: p95 <=6s.
- Reliability: zero silent failures; all errors mapped to typed user-facing states.
- Explainability: every answer includes citations and traceId.

## Rollout and Monitoring
- Feature flags:
- `ENABLE_VIZ`
- `ENABLE_CLIPS`
- `ENABLE_FREEFORM_DSL`
- Default rollout:
- Milestones 0-4 enabled; viz and clips off until validated.
- Structured logs per request:
- plan validity, cache stats, source calls, latencies, failure class.
- Trace retention local-only for POC.

## Assumptions and Defaults
- Official endpoint access is available for private/local testing.
- `MODERN_ERA_START_SEASON` controls lower-bound coverage; default is `1996-97`.
- No auth/multi-tenant requirements in V1.
- Single-user local environment on your machine.
- No public distribution in POC phase.
- If model output fails schema, system retries once with corrective prompt, then hard-fails with explicit error.
- If a query cannot be grounded in stats/video metadata, system returns unsupported response (no hallucinated answer).
