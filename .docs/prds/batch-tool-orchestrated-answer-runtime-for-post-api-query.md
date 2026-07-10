# PRD: Batch Tool-Orchestrated Answer Runtime For `POST /api/query`

- Status: Completed, then superseded as the primary natural-language runtime
- GitHub Issue: [#34](https://github.com/agocharbhatia/hoop-hub/issues/34)

> Historical implementation brief. Its batch planner/orchestrator, grounded answer renderer, partial-result policy, and trace contracts shipped and remain compatibility coverage. Product `/api/query` behavior now belongs to the dynamic tool-loop agent.

## Historical Problem Statement

At the time of this PRD, the natural-language route used a narrow single-query planner and could not compose multiple grounded requests. The scoped batch execution, partial-result, trace, and answer-rendering work shipped. The dynamic agent later replaced this planner/orchestrator as the product route.

That is not a scalable product boundary. As new endpoints, metrics, and stored data are added, the user expects the LLM to become more capable by discovering and using the expanded tool surface. The current architecture pushes too much repo-specific policy into handcrafted planner rules, ties `/api/query` to one structured query at a time, and returns the raw executor response instead of a user-facing answer artifact. The result is a system where capability growth requires recurring natural-language slice work instead of primarily coming from the structured tool contract and its published capabilities.

## Solution

Turn `POST /api/query` into an answer-first orchestration route. A user submits one natural-language question, a planning LLM reads the published stats-tool capability contract and produces a small batch of validated structured tool requests, the server executes those requests through the existing semantic executor, and a rendering LLM writes the final grounded answer from the returned tool results.

This slice should keep the architecture simple and bounded. It is not an open-ended agent loop. It is one planning step, one bounded batch of internal tool executions, and one answer-rendering step. `POST /api/stats/query` remains the strict structured tool API and grounding authority. The new `/api/query` route becomes answer-first, returns the final answer plus supporting tool results, and stores an orchestration trace that records what tool requests were planned and which structured-query traces were executed.

## User Stories

1. As a Hoop Hub user, I want to ask one natural-language NBA stats question and get a direct answer, so that the product feels like a real stats assistant instead of a thin query wrapper.
2. As a Hoop Hub user, I want the app to use whatever supported stats are already in the backend contract, so that new data additions make the product more useful without retraining me on phrasing.
3. As a Hoop Hub user, I want a question like "Show the Celtics offensive and defensive rating this season" to work when those metrics already exist in the tool, so that I am not blocked by planner-family gaps.
4. As a Hoop Hub user, I want a question like "How many wins did the Celtics have in 2023-24?" to be answered through the same runtime as broader supported asks, so that the product feels consistent.
5. As a Hoop Hub user, I want multi-metric season questions to be answered from grounded structured rows, so that the response is factual and inspectable.
6. As a Hoop Hub user, I want simple questions to remain fast, so that a more scalable architecture does not make the app feel heavy.
7. As a Hoop Hub user, I want the app to use more than one structured request when a question legitimately needs it, so that future compound asks are possible without a redesign.
8. As a Hoop Hub user, I want the app to avoid open-ended tool wandering, so that latency and trust remain predictable.
9. As a Hoop Hub user, I want unsupported asks to fail honestly, so that I am not given a plausible but wrong answer.
10. As a Hoop Hub user, I want ambiguous asks to request clarification instead of guessing, so that the product stays trustworthy as it broadens.
11. As a Hoop Hub user, I want partial answers when some supporting data is available and some is not, so that one failed tool request does not waste the rest of the answer.
12. As a Hoop Hub user, I want warnings when part of a compound answer could not be completed, so that I can judge the answer correctly.
13. As a Hoop Hub user, I want the final answer to sound like an answer, not a raw executor payload, so that the product feels finished.
14. As a Hoop Hub user, I want supporting tables to remain visible when useful, so that I can inspect the actual rows behind the answer.
15. As a Hoop Hub user, I want citations and trace links to keep working on `/api/query`, so that grounding remains transparent.
16. As a Hoop Hub user, I want the trace to show what tool requests were planned and executed, so that I can debug why the answer did or did not work.
17. As a structured API caller, I want `POST /api/stats/query` to stay stable, so that programmatic integrations do not churn while the answer route evolves.
18. As a structured API caller, I want the answer route to reuse the exact same structured validator and executor rules, so that natural-language answers cannot bypass the typed backend contract.
19. As an LLM orchestrator, I want a machine-readable capability contract for the stats tool, so that I can request only supported operations, entities, metrics, seasons, and output modes.
20. As an LLM orchestrator, I want to plan multiple structured tool requests in one batch when needed, so that I do not need an autonomous loop for common compound questions.
21. As an LLM orchestrator, I want the batch size to stay bounded, so that planning remains disciplined and latency stays controlled.
22. As an LLM orchestrator, I want exact duplicate requests removed before execution, so that I do not waste backend work if I over-request.
23. As an LLM orchestrator, I want the answer renderer to see both successful and failed tool results, so that it can explain partial answers honestly.
24. As a developer, I want planner output to move from a single-query contract to a batch planning contract, so that `/api/query` no longer assumes one structured query per answer.
25. As a developer, I want the planning step and the rendering step to be separate LLM contracts, so that "what data do I need?" and "how do I answer?" stay testable and independently evolvable.
26. As a developer, I want a dedicated orchestration module for `/api/query`, so that route code stays thin and the new runtime does not collapse into route glue.
27. As a developer, I want a dedicated batch executor module, so that validation, normalization, deduplication, ordering, and partial-result policy live in one place.
28. As a developer, I want the batch executor to call server modules directly instead of HTTP-fetching its own routes, so that the runtime stays efficient and testable.
29. As a developer, I want exact normalized-query deduplication in v1, so that execution efficiency does not depend on prompt wording.
30. As a developer, I want the planner to stay conservative and prefer clarification over guessing when multiple materially different tool plans are plausible, so that answer quality remains trustworthy.
31. As a developer, I want clear-but-unsupported asks to return a typed coverage gap instead of a server error, so that capability boundaries remain legible.
32. As a developer, I want partial-answer policy to be explicit, so that callers and tests agree on what `ok` means under batch execution.
33. As a developer, I want `/api/query` to return an answer-first payload with `toolResults`, so that the UI can render the answer while retaining inspectable grounding artifacts.
34. As a developer, I want `/api/query` traces to stop pretending there is one `resolvedQuery`, so that traces do not lie once batch execution exists.
35. As a developer, I want orchestration traces to reference the underlying structured-query traces, so that detailed grounding remains inspectable without redesigning the semantic executor trace model.
36. As a developer, I want custom ad hoc derivations kept out of the first slice, so that this refactor does not sprawl across planning, compute, and formula execution all at once.
37. As a QA engineer, I want planner contract tests that cover single-request plans, multi-request plans, ambiguities, unsupported asks, and batch-size enforcement, so that the new planning boundary is locked before implementation spreads.
38. As a QA engineer, I want batch executor tests that cover normalization, exact dedup, order preservation, and partial success, so that the orchestration layer is behaviorally pinned.
39. As a QA engineer, I want `/api/query` route tests for answer-first payloads, partial answers, and non-ok planner behavior, so that the client-visible contract stays stable.
40. As a QA engineer, I want `/api/query-trace` tests for orchestration traces, so that the new trace model remains trustworthy as the answer runtime evolves.
41. As a future engineer, I want new supported metrics and endpoints to mostly require capability/validator/executor expansion rather than new NL slices, so that the product scales by expanding the tool substrate.
42. As a future engineer, I want this slice to preserve the separation between tool capability growth and answer composition, so that future charting, derivations, and domain expansion can build on the same boundary.

## Implementation Decisions

- Replace the current single-query planner model behind `POST /api/query` with an answer-first orchestration flow: plan batch, execute batch, render answer.
- Keep `POST /api/stats/query` unchanged as the public single-query structured tool contract and the grounding authority.
- Introduce a new batch planning contract rather than extending the existing single-query planner decision type.
- Restrict the batch planning contract to exactly two categories of outcomes:
  - `planned` with `toolRequests`
  - typed non-ok with `clarification_needed` or `coverage_gap`
- Do not allow the planning step to emit prose answers, planner notes, execution hints, or custom derivation code.
- Treat the planning LLM and the answer-rendering LLM as separate steps with separate contracts.
- Add a dedicated query orchestrator module that owns the `/api/query` flow end to end.
- Add a dedicated batch planner module that owns only natural-language-to-batch-tool planning.
- Add a dedicated semantic batch executor module that owns validation, normalization, exact deduplication, execution ordering, and partial-result aggregation.
- Add a dedicated answer renderer module that owns only answer synthesis and optional artifact shaping.
- Keep `/api/query` route code thin; route handlers should validate request bodies, delegate to orchestrator services, and translate unhandled failures into HTTP responses.
- Let the planning step consume the published capability contract as its source of truth for supported operations, entities, metrics, seasons, season types, subject rules, and output modes.
- Preserve the existing semantic validator as the authoritative gate before any structured request executes.
- Execute planned requests through server-side module calls rather than route-to-route HTTP requests.
- Support a bounded batch of up to 3 structured tool requests per `/api/query` answer in v1.
- Reject, reprompt, or convert to typed clarification behavior when the planner proposes more than 3 tool requests; do not execute an oversized batch.
- Normalize and validate every planned structured query through the same path used by the public structured route before deduplication or execution.
- Deduplicate only exact normalized structured-query equality in v1; do not attempt fuzzy merging or aggressive query coalescing.
- Preserve original request order for non-duplicate planned tool requests.
- Use conservative planner behavior:
  - one clear plan -> execute
  - multiple materially different plausible plans -> `clarification_needed`
  - clear but unsupported request -> `coverage_gap`
- Keep top-level `/api/query` statuses as `ok`, `clarification_needed`, and `coverage_gap`.
- Define `ok` for the answer route as "an answer was produced from at least one successful structured tool result."
- Represent partial answers as `ok` plus warnings, not as a separate top-level status.
- If zero planned tool requests succeed after valid planning, return `coverage_gap`.
- Keep custom ad hoc derivations and arbitrary computation plans out of scope for the first slice.
- Allow only already-supported computed metrics that are first-class in the structured metric/validator/executor surface.
- Change `/api/query` from returning raw executor payloads to returning an answer-first payload with:
  - `status`
  - `answer`
  - `artifacts`
  - `toolResults`
  - `citations`
  - `warnings`
  - `traceId`
- Include raw executed tool results in the `/api/query` response payload, not just in trace data, so the UI and debugging surfaces retain inspectable grounding.
- Keep v1 answer artifacts intentionally small: table artifacts and optional text blocks only.
- Do not introduce chart artifacts, custom visualization grammars, or markdown-rich answer sections in this slice.
- Replace the current single-query `/api/query` trace semantics with orchestration trace semantics.
- Keep per-query semantic executor traces intact; do not stretch the existing semantic executor trace model into a fake batch trace.
- Add an orchestration trace shape for `/api/query` that records:
  - normalized question
  - planned tool requests
  - executed tool trace ids
  - aggregated source calls
  - warnings
  - latency
  - cache/freshness summary
  - answer-route status
- Do not store a fake single `resolvedQuery` for answer-route traces once multiple tool requests are possible.
- Replace `/api/query` directly without a long-lived feature flag.
- Leave `/api/stats/query` existing tests and behavior untouched as the stable executor safety net.
- Update the app UI to consume the new answer-first `/api/query` payload while continuing to surface structured grounding data where helpful.
- Preserve the existing capability-growth philosophy: future backend support should come primarily from capability metadata plus executor support, not from repeated NL slice hardcoding.

## Testing Decisions

- Good tests should lock public behavior, typed contracts, and failure semantics rather than internal implementation details. The goal is to prove what questions can be asked, what payloads are returned, what happens under ambiguity or partial failure, and whether traces remain honest.
- Follow the repo's existing behavior-first prior art for API route tests, semantic executor tests, and trace tests. Use deterministic injected boundaries instead of live model behavior in the default suite.
- Write the first new tests before implementation for the new orchestration boundary.
- Add batch planner tests covering:
  - valid single-request plans
  - valid multi-request plans
  - clear unsupported asks returning `coverage_gap`
  - ambiguous asks returning `clarification_needed`
  - oversized plans rejected or converted before execution
- Add batch planner tests that prove planning is derived from the shared capability contract rather than hand-maintained route-specific lists.
- Add semantic batch executor tests covering:
  - request validation through the existing structured validator
  - normalization/defaulting before equality comparison
  - exact normalized deduplication
  - non-duplicate order preservation
  - mixed success/failure batches
  - warnings emitted for failed tool results during partial answers
- Keep `/api/stats/query` route tests and semantic executor tests as regression coverage for the single-query tool boundary.
- Add `/api/query` route tests covering:
  - invalid JSON and blank questions
  - planner non-ok responses that never execute tools
  - successful answer-first responses with `toolResults`
  - partial-answer `ok` responses with warnings
  - zero-success batches returning `coverage_gap`
- Add answer-renderer tests that prove grounded answer synthesis stays bounded to supplied tool results and warning context, not implementation details of prompt text.
- Add orchestration trace tests for `GET /api/query-trace/:traceId` covering:
  - planned tool requests persisted for answer-route traces
  - executed tool trace ids persisted and returned
  - aggregated source-call and freshness data
  - absence of a fake single `resolvedQuery`
- Preserve model-free default tests. The default suite should not depend on live OpenAI responses or live NBA responses.
- Prefer deterministic fake planner and fake renderer boundaries in tests so contract drift is caught without network calls.
- Keep the old single-query planner tests only where they still apply to the structured executor or shared validation behavior; remove route-contract assumptions that `/api/query` returns raw `StatsQueryResponse`.
- Prior art for the new tests already exists in the codebase's route-contract tests, semantic executor tests, nightly cache tests, and trace tests. The new modules should follow that same external-behavior style.

## Out of Scope

This PRD does not include arbitrary user-authored derivation formulas, a generic computation language, chart artifact generation, public batch stats routes, recursive agent loops, open-ended multi-turn tool use, session memory, new executor capabilities beyond the current structured capability surface, fuzzy merging of overlapping structured requests, or a long-lived feature flag preserving both old and new `/api/query` contracts.

It also does not include redesigning the existing semantic executor trace model into a batch-native model. Instead, the answer route should add an orchestration trace layer that references existing per-query semantic traces.

## Further Notes

Recommended tracer-bullet slice boundaries for `prd-to-issues`:

1. Define new batch-planning, answer-response, and orchestration-trace contracts.
2. Build deterministic batch planner service tests and schema/prompt boundaries against the shared capability contract.
3. Build the semantic batch executor with normalization, exact deduplication, and partial-success policy.
4. Build the answer renderer contract and tests for grounded answer shaping plus minimal artifacts.
5. Add the query orchestrator and replace `/api/query` with the new answer-first flow.
6. Update `/api/query-trace` to return orchestration traces that reference executed structured-query traces.
7. Update the UI to consume the new `/api/query` response while preserving grounding visibility.
8. Run full regression verification with existing structured-route and semantic-executor tests still green.

The core architecture choice is deliberate: make `/api/query` an answer orchestrator over a stable structured tool, not a hand-authored query-family planner. Capability growth should primarily come from structured tool support and published metadata, while the LLM becomes better by using that tool surface rather than by accumulating one-off natural-language slices.
