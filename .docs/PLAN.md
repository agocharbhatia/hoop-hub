# Hoop Hub Plan

This plan supersedes the older `QueryPlan`-first package-split draft. It reflects the current repo state and the next intended architectural moves.

## Summary

Hoop Hub is a stats-grounded NBA natural-language search engine built as a single Bun + SvelteKit app.

Today, the app already has:
- a structured semantic query API
- a natural-language wrapper over the same semantic executor
- retrieval against official NBA endpoints with SQLite-backed caching
- canonical semantic traces with source-call and freshness details
- compact structured result rows for the currently supported query families

The main remaining work is not “finish the old legacy intent system.” The remaining work is:
- broader semantic planning and entity resolution
- nightly-first materialization and stored-data-first reads
- computed/derived metric execution
- persisted session grounding
- richer answer and artifact composition on top of structured rows

## Current Shipped State

### Runtime

- Single Bun + SvelteKit app in `apps/web`
- Primary structured route: `POST /api/stats/query`
- Natural-language wrapper: `POST /api/chat/query`
- Trace route: `GET /api/query-trace/:traceId`

### Query Execution

- Supported semantic query families:
  - player rankings
  - player trends
  - player comparisons
  - team defensive rankings
- Supported queries execute through the semantic executor in `apps/web/src/lib/server/semantic/query-service.ts`
- Structured responses return compact canonical rows; summaries are secondary
- Traces expose canonical `resolvedQuery` data, source calls, warnings, cache stats, and latency

### Data and Resolution

- Retrieval is still live-fetch-first against official NBA endpoints
- SQLite stores cache and operational metadata
- Finalized nightly-first materialization is not implemented yet
- Player resolution uses the shared seeded player-directory snapshot and curated aliases
- `allowLiveFallback` is a real execution policy input and should gate both endpoint retrieval and directory refresh behavior

### UX and Session State

- The UI shows structured results, citations, warnings, and trace details
- `sessionId` is currently validated at the chat boundary but does not yet load or persist conversational context
- Follow-up chips are a UI convenience, not real multi-turn engine memory

### Legacy Boundary

- The repo still contains the older planner/mock-engine path for compatibility tests
- New product behavior should not be added there unless the task is explicitly about compatibility or migration
- Future runtime work should consolidate around one semantic query boundary

## Current Public Contracts

### `POST /api/stats/query`

Purpose:
- primary structured tool contract for LLM or programmatic callers

Current request shape:
```ts
type SemanticQueryRequest = {
  question?: string;
  query: {
    operation: 'lookup' | 'rank' | 'compare' | 'trend' | 'split' | 'game' | 'event';
    entity: 'player' | 'team' | 'game' | 'event' | 'league';
    subject: {
      names?: string[];
      ids?: string[];
    };
    metrics: string[];
    filters: {
      season?: string | null;
      seasonType?: string | null;
      window?: { type: 'last_n_games'; n: number } | null;
      dateFrom?: string | null;
      dateTo?: string | null;
    };
    orderBy?: { metric: string; direction: 'asc' | 'desc' } | null;
    limit?: number | null;
    outputMode?: string | null;
  };
  options?: {
    allowLiveFallback?: boolean;
  };
};
```

Current response shape:
```ts
type StatsQueryResponse = {
  status: 'ok' | 'clarification_needed' | 'coverage_gap';
  result: {
    shape: 'ranking' | 'timeseries' | 'comparison';
    columns: string[];
    rows: Array<Record<string, string | number | null>>;
    summary?: string;
  } | null;
  citations: Citation[];
  provenance: {
    executor: 'semantic_executor';
    resolvedQuery: SemanticQuery | null;
    dataFreshnessMode: DataFreshnessMode;
    sourceCalls: TraceSourceCall[];
  };
  warnings: StatsQueryWarning[];
  traceId: string;
};
```

### `POST /api/chat/query`

Purpose:
- raw natural-language wrapper over the semantic executor

Current request shape:
```ts
type ChatQueryRequest = {
  sessionId: string;
  message: string;
  clientTs?: string;
};
```

Current response shape:
- same `StatsQueryResponse` structure as `POST /api/stats/query`

Important note:
- `sessionId` is currently validated but not yet used for persisted conversational grounding

### `GET /api/query-trace/:traceId`

Purpose:
- return semantic execution trace details for the UI and debugging

Current trace shape:
```ts
type QueryTraceResponse = {
  traceId: string;
  normalizedQuestion: string;
  status: 'ok' | 'clarification_needed' | 'coverage_gap';
  resolvedQuery: SemanticQuery | null;
  dataFreshnessMode: DataFreshnessMode;
  sourceCalls: TraceSourceCall[];
  executedSources: Citation[];
  warnings: StatsQueryWarning[];
  computations: unknown[];
  latencyMs: {
    planning: number;
    retrieval: number;
    compute: number;
    render: number;
    total: number;
  };
  cache: {
    hits: number;
    misses: number;
  };
};
```

## Repository Reality

Do not follow the old package-split assumptions from the previous draft unless the repo actually grows into them later.

Relevant current paths:
- `apps/web/src/lib/contracts`
- `apps/web/src/lib/server/data`
- `apps/web/src/lib/server/players`
- `apps/web/src/lib/server/semantic`
- `apps/web/src/routes`
- `agents/current-state.md`
- `agents/memory.md`

## Completed Milestones

1. Foundation
- SvelteKit app scaffold
- health route
- base contracts and tests

2. Planning and metric groundwork
- deterministic normalization
- metric resolution
- planner invariants and validation

3. Official endpoint adapters and cache
- official NBA endpoint adapter
- SQLite-backed cache
- source-call persistence

4. Structured semantic execution for the initial vertical slice
- `POST /api/stats/query` as the primary structured route
- `POST /api/chat/query` as NL wrapper
- semantic traces with canonical `resolvedQuery`
- structured row extraction for the currently supported query families

5. Seeded player-directory and canonicalized subject resolution
- shared seeded directory snapshot
- curated aliases
- canonical subject data reflected in provenance and traces
- live-fallback gating tied to retrieval and directory refresh

## Next Milestones

### Milestone A: Consolidate on one semantic runtime

Goals:
- stop extending the legacy planner/mock-engine path for product behavior
- make the semantic executor the only path future features target

Exit criteria:
- future engine slices land only on the semantic runtime path
- legacy code is clearly compatibility-only or retired

### Milestone B: Broader semantic planning and entity resolution

Goals:
- expand beyond the current narrow NL wrapper
- handle more players, teams, seasons, and disambiguation cases
- improve typed clarification responses for ambiguous user inputs

Exit criteria:
- broader exact-name and alias coverage
- cleaner ambiguity handling
- more natural-language stat questions map into supported semantic queries

### Milestone C: Nightly-first materialization and stored-data-first reads

Goals:
- move from live-fetch-first to a materialized canonical read path where possible
- preserve live fallback only for current-day or uncovered cases

Exit criteria:
- nightly ingest/finalization path exists
- supported reads prefer stored canonical data over raw live fetches

### Milestone D: Computed and derived metrics

Goals:
- support grounded derived metrics on top of canonical data
- keep the execution model typed and auditable

Exit criteria:
- derived metric requests produce explainable computed outputs
- provenance traces include source fields and computation details

### Milestone E: Session grounding and answer/artifact composition

Goals:
- make `sessionId` meaningful
- support follow-up resolution against prior context without losing grounding
- improve answer composition and artifact rendering on top of structured rows

Exit criteria:
- persisted session context exists
- follow-up queries can reuse prior grounded context
- answer composition remains citation- and trace-backed

## Constraints and Non-Goals

### Constraints

- Every supported answer must remain grounded in NBA data or a typed coverage/clarification response
- Default CI should remain deterministic and fixture-backed
- Live integration smoke coverage should stay isolated from default PR gating
- New execution features should prefer extending semantic contracts rather than adding new legacy intent enums

### Non-Goals Right Now

- pretending `sessionId` is already full memory
- adding new user-facing behavior to the legacy mock engine
- treating summaries as the primary execution artifact
- introducing a wide free-form compute engine before the canonical data path is ready

## Verification

Default verification:
```bash
cd apps/web
bun run check
bun run test
bun run build
```

Planning context order for future agents:
1. `agents/current-state.md`
2. `README.md`
3. `apps/web/README.md`
4. `.docs/PLAN.md`
5. `agents/memory.md`
