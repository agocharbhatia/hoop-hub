# PRD: OpenAI Planner Runtime For `POST /api/query` In The Current Stats Domain

- Status: Published
- GitHub Issue: [#9](https://github.com/agocharbhatia/hoop-hub/issues/9)

## Problem Statement

Hoop Hub already has a strong structured stats executor, but the current natural-language entrypoint is still a handwritten translator attached to a legacy-shaped route. That leaves the product with the wrong long-term boundary: natural-language support is narrow, the route contract still carries fake session cues, and expanding the engine would require extending a brittle keyword mapper instead of proving the real planner-to-executor seam.

From the user's perspective, this means the app can answer some NBA stats questions, but it is not yet using the real architecture it intends to grow. From the product and engineering perspective, it means there are still two different query mental models in play: a typed semantic executor that is worth keeping, and a thin natural-language wrapper that is not strong enough to serve as the foundation for future domain expansion.

## Solution

Introduce a new primary route, `POST /api/query`, that accepts a raw question and uses an OpenAI-backed planner to convert that question into a validated typed semantic query for the current stats domain only. Route successful plans into the existing semantic executor, preserve the current `StatsQueryResponse` contract, and return typed `clarification_needed` or `coverage_gap` responses when the planner cannot safely map the ask.

The planner should be deliberately narrow. It should classify only the currently supported stats shapes, normalize metrics into canonical metric IDs, preserve subject order, and stop before canonical subject grounding. The semantic executor should remain the only module that resolves player identities, handles alias ambiguity, defaults canonical filters, retrieves data, and emits canonical executed queries in traces and provenance. The slice should also remove the old chat route and align the UI with actual engine behavior by posting to the new route and dropping fake memory/follow-up cues.

## User Stories

1. As a Hoop Hub user, I want one primary question route for NBA stats asks, so that the product has a clear main entrypoint.
2. As a Hoop Hub user, I want to ask broad natural-language stats questions without constructing a typed query myself, so that the app feels like a real AI querying engine.
3. As a Hoop Hub user, I want “Who’s leading the league in assists?” to work through the new planner path, so that simple league-leader asks feel native.
4. As a Hoop Hub user, I want “How has Jokic scored over his last 5?” to work through the new planner path, so that rolling player-trend asks are supported naturally.
5. As a Hoop Hub user, I want “Compare Curry and Dame in 2023-24” to work through the new planner path, so that supported comparison asks do not depend on keyword glue.
6. As a Hoop Hub user, I want unsupported asks like “Who wins the title?” to return a grounded typed gap, so that the app does not bluff.
7. As a Hoop Hub user, I want under-specified asks like “show me Jokic over his last 5” to request clarification instead of guessing the wrong metric, so that results remain trustworthy.
8. As a Hoop Hub user, I want comparison subject order to match how I asked the question, so that the output is easy to follow.
9. As a Hoop Hub user, I want citations, warnings, and trace links to keep working on the new route, so that the planner upgrade does not remove grounding features.
10. As a Hoop Hub user, I want the trace to show the canonical executed query rather than a raw model guess, so that the trace remains trustworthy.
11. As a structured API caller, I want the direct typed stats route to remain available, so that I can bypass the planner when I already know the semantic query.
12. As a structured API caller, I want the typed executor contract to stay stable while the planner route is added in front of it, so that integrations do not churn.
13. As a developer, I want the planner to emit only closed, supported semantic shapes, so that it cannot invent operations or entities the executor cannot honor.
14. As a developer, I want the planner to normalize metrics to canonical IDs, so that downstream execution does not need a second translation layer.
15. As a developer, I want the planner to stop before canonical subject grounding, so that identity resolution rules remain centralized in one module.
16. As a developer, I want the planner output to use a dedicated typed contract instead of the legacy planner contract, so that new runtime work does not revive deprecated abstractions.
17. As a developer, I want a small planner adapter interface around the OpenAI SDK, so that route logic stays thin and tests stay deterministic.
18. As a developer, I want operational planner failures to surface as real server errors, so that availability problems are not mislabeled as coverage gaps.
19. As a developer, I want planner non-ok decisions to return the same public `StatsQueryResponse` shape as executor responses, so that the client does not need two result models.
20. As a developer, I want the new route to own all natural-language planning behavior, so that there is no immediate drift between two NL endpoints.
21. As a developer, I want the old chat route removed instead of retained with parallel behavior, so that there is one production natural-language path.
22. As a product owner, I want this slice to prove the planner-to-executor boundary without expanding into schedules, standings, rosters, or memory, so that delivery stays focused.
23. As a product owner, I want the UI to stop implying session memory that does not exist, so that the product matches reality.
24. As a product owner, I want recent-question affordances to remain while fake follow-up chips disappear, so that the app stays usable without pretending to be multi-turn.
25. As a QA engineer, I want deterministic planner contract tests that do not depend on live model behavior, so that the default suite remains reliable.
26. As a QA engineer, I want route tests that cover supported planning, planner clarification, planner coverage gaps, and planner failures, so that the new route contract is locked before rollout.
27. As a QA engineer, I want the existing executor tests to remain green unchanged, so that planner work does not accidentally regress the structured runtime.
28. As a QA engineer, I want trace tests migrated to the new route, so that trace semantics stay covered after the old chat route is removed.
29. As a maintainer, I want the OpenAI integration isolated to one module, so that model upgrades and prompt/schema changes do not leak through the runtime.
30. As a maintainer, I want the planner schema to be closed over the current stats slice, so that future expansion happens deliberately instead of through accidental model creativity.
31. As a future engineer, I want this slice to establish the lasting engine boundary, so that later domain expansion builds on the planner seam rather than replacing it.
32. As a future engineer, I want the semantic executor to remain the canonical grounding and trace authority, so that later planners and domains inherit stable semantics.

## Implementation Decisions

- Add a new primary natural-language route that accepts only a non-empty `question` and returns the existing typed stats response contract.
- Keep the existing structured stats route public as the direct executor seam.
- Remove the existing chat route rather than maintaining two production natural-language entrypoints.
- Build a dedicated planner decision contract for the new runtime instead of reusing the legacy planner artifact or returning unstructured model output.
- Use a planner decision model with exactly three outcomes: planned, clarification-needed, and coverage-gap.
- Make a planned decision contain a validated semantic query, not a partially interpreted freeform payload.
- Keep planner output closed to the current supported stats slice: player ranking, player trend, player comparison, and team defensive ranking.
- Restrict planner metric output to canonical metric IDs already supported by the executor.
- Preserve subject order from the user question in planner output.
- Keep canonical subject grounding, alias handling, and ambiguity resolution inside the semantic executor.
- Keep season and season-type canonical defaults in the executor so traces continue to reflect the exact executed query.
- Reserve planner-layer clarification for under-specified natural-language asks that can be detected without grounding.
- Use a small explicit planner warning-code set in this slice rather than ad hoc warning strings.
- Return planner-layer unsupported asks as typed coverage gaps with no executor call.
- Treat planner operational failures, missing configuration, or invalid structured model output as server errors rather than user-facing coverage gaps.
- Isolate the OpenAI integration behind a small adapter interface so that route logic and planner-service tests do not depend directly on SDK behavior.
- Use strict schema validation on planner output before any executor call.
- Revalidate the planner-produced semantic query through the structured semantic validator before execution to prevent model drift from bypassing the executor contract.
- Keep trace semantics centered on canonical executed state; traces should not expose raw planner drafts as the authoritative query.
- For planner non-ok decisions, persist traces with no executed source calls and a null resolved query.
- Remove `sessionId` from the new public natural-language route contract and stop implying memory in the UI.
- Update the UI to keep recent-question and trace affordances while removing fake follow-up and memory cues.
- Do not expand scope into broader query families, new data domains, or visualization redesign in this slice.

## Testing Decisions

- Good tests should lock external behavior and public contracts rather than internal implementation details. The goal is to prove what callers observe: accepted inputs, typed failures, executor delegation, canonical provenance, and stable traces.
- Add planner-service tests that inject fake adapter responses and assert deterministic planner decisions for supported, clarification-needed, and coverage-gap scenarios.
- Add planner-service tests that prove canonical metric IDs are produced, supported shapes remain closed, and subject order is preserved.
- Add planner-service tests for compare-without-metric defaults, scoring-language metric inference, and vague trend asks that should not guess.
- Add route tests for the new natural-language endpoint covering invalid JSON, blank questions, supported planning and execution, planner clarification responses, planner coverage gaps, and planner operational failures.
- Keep the existing structured semantic executor tests as regression coverage for canonical grounding, retrieval behavior, and result rendering.
- Keep the existing structured route tests as regression coverage for the direct executor contract.
- Migrate or replace trace tests so they validate the new route rather than the removed chat route.
- Remove chat-route tests rather than preserving a compatibility route in the default suite.
- Keep all default tests model-free; the default suite should not assert on live OpenAI responses.
- Use a fakeable planner adapter boundary so planner tests can exercise structured-output handling without network calls.
- Preserve behavior-first coverage around canonical traces and provenance, since those are the most important debugging surfaces after execution.
- Prior art already exists in the codebase for service-level semantic execution tests, API route contract tests, trace tests, and fixture-backed data access tests. The new planner tests should follow that same contract-first style.

## Out of Scope

This PRD does not include nightly materialization, stored-data-first reads, session memory, schedules, standings, rosters, predictive or opinion asks, broader filter grammar, richer charts, planner-owned canonical subject grounding, removal of the public structured stats route, or live-model assertions in the default test suite.

It also does not include the separate removal or redesign of the live-fallback execution policy, since that work is already happening on another branch.

## Further Notes

Recommended tracer-bullet slice boundaries for follow-on issue slicing:

1. Planner contract and schema boundary
2. Planner adapter and deterministic service tests
3. New natural-language route orchestration and non-ok trace behavior
4. Removal of the old chat route and trace-test migration
5. UI switch to the new route plus removal of fake follow-up and memory cues

This PRD should be considered implementation-ready only if issue slicing preserves one core rule: the planner translates questions into a small validated semantic surface, and the semantic executor remains the only grounding and execution authority.
