# Architecture and tradeoffs

Hoop Hub separates question interpretation from data execution. A language model can choose among published tools, but supported computations, scope checks, and canonical artifacts belong to the server.

## Request flow

1. The [request hook](../apps/web/src/hooks.server.ts) applies authentication, same-origin mutation checks, body limits, and the current principal. Local mode accepts loopback requests; deployed modes isolate accounts or visitors.
2. [`POST /api/query`](../apps/web/src/routes/api/query/+server.ts) validates the question and acquires a research permit. It returns JSON or server-sent events with progress, verified artifact snapshots, and the final answer.
3. The [agent service](../apps/web/src/lib/server/agent/service.ts) loads bounded, previously validated session context, resolves identities, and runs the model/tool loop. Defaults allow eight tool iterations and a 60-second planning budget; the combined abort signal has additional time for finalization. Individual transports have their own deadlines.
4. Tool execution validates endpoint parameters and research scope before fetching or computing. Identity tools execute first; independent data tools run in batches of three. Equivalent successful source requests share one promise within the answer. Failed requests are evicted so a repair can retry.
5. Supported statistics and artifacts are computed or reconciled from tool results. A model-authored chart or table cannot override canonical rows for a supported computation. Source failures, incomplete joins, small samples, and unsupported scope become explicit warnings or coverage gaps.
6. [Research persistence](../apps/web/src/lib/server/research/repository.ts) saves the rendered answer and validated context separately. Narrow follow-ups can replay validated requests; broader questions return to the model with bounded context. Every saved resource remains bound to its owner.

Client disconnects abort the SSE stream and propagate to model requests and source transports. Admission permits remain held until the underlying research operation settles. This avoids admitting replacement work while an earlier disconnected request is still finishing.

## Two data execution paths

| Path | Reads | Purpose |
| --- | --- | --- |
| Dynamic tools | Cataloged NBA endpoints, provider adapters, and persistent caches | Flexible natural-language research, aggregations, trends, matchups, and exact-event clips. |
| Structured semantic runtime | Stored, materialized endpoint payloads | Typed player/team lookups, rankings, trends, splits, comparisons, standings, and schedules. |

The agent can call the structured runtime through `execute_semantic_query`. An empty structured cache returns `nightly_data_unavailable`; it does not silently perform a live fetch. Dynamic NBA retrieval can use live endpoints with cache reuse. The PBP Stats adapter serves a fresh cache hit first, then attempts retrieval and explicitly labels any stale fallback.

This split makes structured execution reproducible while retaining a broader research interface. It also makes freshness and availability part of the response contract instead of an assumption shared by every tool.

## Data integrity and recovery

The [data store](../apps/web/src/lib/server/data/store/data-store.ts) persists endpoint payloads, source-call traces, nightly run/request state, research sessions, boards, and export records. Cache identity includes normalized parameters and parser versions; payload checksums detect local corruption. Snapshot dates and expiration state distinguish current, provisional, stale, and unavailable materializations.

The [nightly pipeline](../apps/web/src/lib/server/nightly/bootstrap-service.ts) records progress at request granularity, reuses valid stored work, and processes phases with bounded concurrency. Its [audit](../apps/web/src/lib/server/nightly/data-health.ts) checks run completion, request/cache agreement, JSON integrity, and checksums. Scheduling a GitHub workflow produces artifacts in that workflow; it does not automatically update a separately hosted app database.

The [PBP Stats adapter](../apps/web/src/lib/server/data/providers/client.ts) limits active retrievals to two and queued requests to 32 per fetcher instance. Its shared 30-second deadline includes queueing, backoff, and at most two attempts; each attempt has a 20-second deadline. Only transient transport and HTTP errors retry. Cancellation also interrupts queueing and `Retry-After` waits. Malformed payloads cannot become successful empty datasets. Public-display entitlement is checked before cache access.

## Computation before presentation

- **Rankings:** qualify and rank the complete retrieved population before returning a bounded selection. Stable ordering handles numeric strings, ties, and missing values.
- **Trends:** order games chronologically and calculate windows per subject and metric. Different players do not borrow each other's last game date. Mixed metrics retain separate charts.
- **Splits:** compute pooled percentages from their underlying makes and attempts. Missing or impossible denominators remain unavailable instead of becoming zero.
- **Shot research:** filter source events, retain their identities, and join video using `(gameId, eventId)`. Missing media reduces playable coverage, not the shooting denominator.
- **Follow-ups:** replay validated scope for narrow changes. Unsupported filters cannot silently broaden a named-player, date, opponent, or action population.

The [engineering evidence guide](engineering-evidence.md) links each behavior to focused regressions, including deliberately fabricated model outputs. These are bounded guarantees for supported paths, not proof that every generated sentence is correct.

## Ownership and bounded work

[Authentication](../apps/web/src/lib/server/beta/auth.ts) uses opaque sessions and hashed invitation tokens. Ownership is enforced inside research, board, trace, feedback, and export access paths. Credential routes have persistent throttles; deployed responses avoid caching private research.

[Admission controls](../apps/web/src/lib/server/beta/limits.ts) permit one active research operation per user and bound global concurrency. Daily research limits are configurable and unrestricted by default; per-minute and concurrency limits still apply. Quota state persists in SQLite; active-work accounting is process-local.

Saved research has retention and payload limits. [Clip compilation](../apps/web/src/lib/server/clip-exports/service.ts) accepts events from an owned saved playlist instead of client-supplied media URLs or FFmpeg arguments. It uses one worker, a bounded queue, a 40-clip selection limit, and bounded download/compile resources. Completed downloads expire after 24 hours. Interrupted jobs are surfaced as failed after restart rather than reported as still running.

## Deployment choices

| Choice | Why it fits this project | Boundary |
| --- | --- | --- |
| One SvelteKit app | Shares typed contracts across the UI, routes, and backend without extra network services. | Research, caching, and media work share an app deployment. |
| SQLite | Simple local setup, persistent ownership, request-level materialization state, and portable snapshots. | A single-host design; multiple replicas need a coordinated data and execution model. |
| Node in production; Bun for tooling | Uses Node HTTP and built-in SQLite while keeping development and deterministic tests fast to run. | Native server capabilities and child processes are required; this is not an edge-runtime deployment. |
| Process-local clip worker | Bounds CPU and media work without adding a broker for a pilot. | Running exports are not resumed across restarts; there is no distributed queue. |
| Explicit model adapter | Scripted model turns exercise real orchestration without credentials. | Offline tests do not measure how reliably a live model chooses tools. |

Production builds package NBA subprocess transports as private assets. The [build check](../apps/web/scripts/check-node-transport-build.ts) relocates the output and verifies that both transport entrypoints launch, catching source-tree path assumptions before deployment.

The [Docker image](../Dockerfile) runs as a non-root user, includes FFmpeg, and stores durable data in mounted volumes. [Compose](../compose.yaml) restricts the direct app port to loopback and supports a Caddy HTTPS proxy. Deployment, backup/restore commands, and hosted acceptance are covered in the [operations runbook](../.docs/BETA_DEPLOYMENT.md).

## Where to read the code

| Directory | Responsibility |
| --- | --- |
| [`agent/`](../apps/web/src/lib/server/agent/) | Tool orchestration, query scope, computation, artifact reconciliation, and session grounding. |
| [`semantic/`](../apps/web/src/lib/server/semantic/) | Validated structured queries over materialized data. |
| [`data/`](../apps/web/src/lib/server/data/) | Endpoint/provider catalogs, transports, normalized cache keys, and SQLite storage. |
| [`nightly/`](../apps/web/src/lib/server/nightly/) | Resumable materialization and integrity/freshness audits. |
| [`research/`](../apps/web/src/lib/server/research/) | Owned history, boards, and server-side view refinements. |
| [`beta/`](../apps/web/src/lib/server/beta/) | Authentication, admission, ownership context, feedback, readiness, and backups. |
| [`clip-exports/`](../apps/web/src/lib/server/clip-exports/) | Saved-event validation, media compilation, and export lifecycle. |
| [`eval/`](../apps/web/src/lib/server/eval/) | Scripted, model-fixture, and live evaluations with budgets and redacted reports. |
| [`contracts/`](../apps/web/src/lib/contracts/) | Shared query, artifact, trace, research, and stream types. |

`planner/`, `query-orchestrator/`, `answer-renderer/`, and `mock/` retain compatibility paths and tests. The dynamic agent is the production natural-language runtime. Consolidating these older surfaces is remaining maintenance work. Historical implementation notes stay under [`.docs/`](../.docs/) and [`agents/`](../agents/); the public documentation describes the current code rather than treating old plans as shipped behavior.
