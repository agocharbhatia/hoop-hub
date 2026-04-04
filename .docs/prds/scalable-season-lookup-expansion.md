# PRD: Scalable Season Lookup Expansion

- Status: Published
- GitHub Issue: [#25](https://github.com/agocharbhatia/hoop-hub/issues/25)

## Problem Statement

Hoop Hub's current structured stats runtime can answer a narrow set of grounded NBA questions, but it cannot yet support broad season-level lookup asks across players and teams. From the user's perspective, that means many normal questions like "What is Jokic averaging this season?", "What's the Thunder record?", or "What is Boston's offensive rating?" either cannot be answered or require the LLM to bridge missing product behavior with prompt logic instead of using a grounded data tool.

That is the wrong long-term boundary for the product. The user wants the LLM to use Hoop Hub as a factual tool and knowledge map, not as an incomplete sidecar that forces the model to guess what stats exist, what outputs are valid, or how to request them. If the LLM cannot discover the real tool surface and ask for supported season data safely, expansion becomes brittle and trust drops quickly. The current runtime also lacks a shared team resolver, a first-class lookup execution path, richer stored season payload coverage, and a machine-readable capability contract that tells the orchestration layer what the system can actually do.

## Solution

Expand the semantic executor with a first-class `lookup` operation for season-level player and team stat retrieval, backed by stored nightly materialized season rows and a shared semantic metric registry. The slice should support exactly one subject per request, one or more canonical metric IDs, current-season defaulting plus explicit `2023-24`, and a deterministic `table` result shape with one canonical row per subject.

The runtime should remain tool-first and grounded. The semantic executor returns structured season stats, warnings, provenance, traces, and capabilities. The LLM above the tool remains responsible for deciding how to present those results to the end user. To support that orchestration model, the slice should also add a machine-readable capabilities contract that declares what operations, entities, metrics, seasons, season types, output modes, and subject-cardinality rules are actually supported. The planner should expand to broad lookup phrasing, but it should remain closed to the same supported runtime surface and continue to stop before canonical subject grounding.

## User Stories

1. As a Hoop Hub user, I want to ask what a player is averaging this season, so that I can get a direct season snapshot instead of a ranking or trend artifact.
2. As a Hoop Hub user, I want to ask what a team is averaging this season, so that I can retrieve grounded team season stats without relying on defensive-ranking-only support.
3. As a Hoop Hub user, I want to ask for one player and multiple season metrics at once, so that I can get one coherent season row instead of stitching together multiple answers.
4. As a Hoop Hub user, I want to ask for one team and multiple season metrics at once, so that I can see record and efficiency context together.
5. As a Hoop Hub user, I want current-season lookup asks to work without saying the season explicitly, so that common NBA questions feel natural.
6. As a Hoop Hub user, I want explicit `2023-24` lookup asks to work, so that I can query the supported demo historical season.
7. As a Hoop Hub user, I want unsupported explicit seasons to fail honestly, so that I am not misled into thinking the runtime supports historical depth it does not have yet.
8. As a Hoop Hub user, I want unsupported season types like playoffs to fail honestly, so that the product does not quietly mix incompatible data semantics.
9. As a Hoop Hub user, I want "What is Jokic averaging this season?" to resolve to a canonical player and a grounded season row, so that the answer is trustworthy.
10. As a Hoop Hub user, I want "How many assists is Curry averaging in 2023-24?" to work through the lookup path, so that alias-based season lookup feels product-ready.
11. As a Hoop Hub user, I want "What are the Lakers averaging in rebounds?" to work through the lookup path, so that team season asks are first-class.
12. As a Hoop Hub user, I want "What's the Thunder record?" to return wins, losses, and win percentage from grounded stored data, so that season record questions are covered.
13. As a Hoop Hub user, I want "What is Boston's offensive rating?" to use the correct team season source surface, so that advanced metrics are grounded instead of improvised.
14. As a Hoop Hub user, I want "How is Tatum shooting from three this season?" to resolve to a season shooting percentage lookup, so that normal phrasing maps cleanly into season stats.
15. As a Hoop Hub user, I want vague asks like "How is Jokic doing?" to request clarification instead of guessing, so that the product stays trustworthy.
16. As a Hoop Hub user, I want ambiguous team shorthand like "LA" to request clarification instead of guessing, so that identity resolution remains dependable.
17. As a Hoop Hub user, I want unknown subjects to return a grounded gap instead of a fabricated answer, so that unsupported lookups are clearly communicated.
18. As a Hoop Hub user, I want the trace for a lookup ask to show the canonical resolved subject, season, and stored data sources, so that the underlying execution is inspectable.
19. As a Hoop Hub user, I want the app to reuse stored nightly data for supported season asks, so that responses do not depend on request-time live fetches.
20. As an LLM orchestrator, I want a machine-readable capability contract for the stats tool, so that I only request operations, metrics, and outputs the backend actually supports.
21. As an LLM orchestrator, I want the capability contract to tell me which output modes are valid for lookup, so that I do not ask for graphs before they exist.
22. As an LLM orchestrator, I want canonical metric IDs listed explicitly, so that I can form valid structured lookup requests without guessing aliases.
23. As an LLM orchestrator, I want supported seasons and season types declared explicitly, so that I can avoid invalid season requests before execution.
24. As an LLM orchestrator, I want subject-cardinality rules declared explicitly, so that I know lookup supports exactly one player or one team in this slice.
25. As a structured API caller, I want `POST /api/stats/query` to accept direct `lookup` requests, so that I can use the stats tool without going through natural-language planning.
26. As a structured API caller, I want structured requests to use canonical metric IDs only, so that the contract stays compact and deterministic.
27. As a structured API caller, I want canonical resolved identities reflected in `resolvedQuery`, so that traces and provenance show the exact grounded request that ran.
28. As a planner developer, I want natural-language lookup support to be derived from the same capability source of truth as executor validation, so that planner prompts do not drift from runtime support.
29. As a planner developer, I want the planner to stop before subject grounding, so that identity resolution remains centralized in executor-side resolvers.
30. As an executor developer, I want lookup to read league-wide season rows and filter by subject, so that the runtime does not accumulate bespoke per-metric codepaths.
31. As an executor developer, I want team lookup to merge metrics from approved season source variants into one row, so that the public contract stays stable even when metrics come from different stored request shapes.
32. As an executor developer, I want the active runtime to validate metrics through one semantic metric registry, so that new lookup work does not introduce a second contract system beside the current semantic one.
33. As an executor developer, I want unsupported metrics to fail the whole lookup request instead of partially succeeding, so that callers never have to interpret partial rows.
34. As an executor developer, I want lookup output to remain structured table data only, so that the LLM layer can decide whether to present it as prose, a table, or a future artifact.
35. As a resolver developer, I want a team directory and alias overlay parallel to the player directory, so that team identity logic is reusable and centralized.
36. As a nightly data developer, I want source-variant materialization planned explicitly for lookup support, so that broader season questions succeed from stored data instead of fixture-only hacks.
37. As a nightly data developer, I want current-season and `2023-24` lookup support to use the same generalized materialization seams, so that future season expansion is additive.
38. As a QA engineer, I want richer deterministic season fixtures that cover the supported lookup metric surface, so that tests represent the real shipped capability instead of stubbed fragments.
39. As a QA engineer, I want the bootstrap fixture fetcher and direct test seeding to share the same richer payload surface, so that runtime and bootstrap tests do not drift apart.
40. As a QA engineer, I want planner, executor, route, trace, and bootstrap tests to lock lookup behavior at the contract boundary, so that future expansions cannot silently regress the slice.
41. As a product owner, I want this slice to establish the durable season lookup tool surface rather than overfitting to demo prompts, so that future domains can build on the same architecture.
42. As a product owner, I want the LLM to discover what the tool can do through capabilities instead of prompt-only folklore, so that the system expands safely.
43. As a product owner, I want this slice to prepare for future metric-expression compute without implementing generic compute-plan synthesis yet, so that the product can expand while staying grounded.
44. As a future engineer, I want the capability registry to be the single source of truth for both validation and externally exposed capabilities, so that orchestration and execution cannot disagree.
45. As a future engineer, I want lookup to remain a deep module with small public interfaces, so that standings, schedule, roster, and future domains can follow the same pattern instead of copying prompt-specific logic.

## Implementation Decisions

- Add first-class semantic lookup support for `lookup/player` and `lookup/team` in the production semantic executor.
- Keep the semantic contract as the only active runtime source of truth and avoid extending legacy mock planner or legacy intent abstractions for new product behavior.
- Unify active runtime metric validation under one semantic metric registry keyed by supported semantic operations and entity scopes.
- Make the semantic metric registry the place where each metric declares its public ID, display metadata, allowed operations, allowed entities, required source variant, and source-field or closed derivation behavior.
- Keep structured metric requests canonical-ID only; natural-language aliases remain planner-layer concerns.
- Introduce a shared capability registry as the single source of truth for supported operations, entities, output modes, metrics, seasons, season types, and subject-cardinality rules.
- Expose the public capabilities contract through a new route while keeping internal source variants, raw field names, and endpoint parameter details private.
- Use the shared capability registry to drive both executor validation and planner prompt/schema construction wherever practical.
- Keep lookup limited to exactly one subject per request in this slice.
- Make the structured subject contract for lookup parallel to existing player contracts: accept `subject.names`, `subject.ids`, or matching pairs of both, with executor-side canonical resolution.
- Preserve the rule that the planner stops before canonical subject grounding; player and team resolvers remain executor-owned.
- Add a team directory and alias overlay parallel to the player directory, using a static in-repo NBA team snapshot plus curated aliases for this slice rather than DB-backed team refresh logic.
- Surface ambiguous player or team alias inputs as `clarification_needed` instead of guessing.
- Treat unknown subjects as grounded coverage gaps rather than fabricated or partially resolved responses.
- Support only current season and explicit `2023-24` in this slice.
- Support only `Regular Season` in this slice, defaulting canonical execution to `Regular Season`.
- Return a distinct typed warning for unsupported explicit seasons instead of mislabeling them as missing nightly data.
- Return a distinct typed warning for unsupported season types instead of silently coercing them.
- Keep lookup execution strictly on top of stored league-wide season rows filtered by resolved subject, not player- or team-specific bespoke endpoints.
- Introduce explicit materialized season source variants for lookup support, including at minimum one player base season source and separate team base and team advanced season sources.
- Allow one lookup request to merge metrics from multiple approved team season source variants into one canonical response row.
- Keep the lookup result shape as `table` with exactly one row per resolved subject.
- Use stable identity-first columns in the lookup row contract, followed by canonical season metadata and requested metrics.
- Keep lookup output/artifact generation limited to structured data; do not make the executor responsible for final prose or graph generation in this slice.
- Treat unsupported or unavailable requested metrics as all-or-nothing lookup failures; do not drop unsupported metrics and return partial rows.
- Allow only closed explicit derived metrics that are necessary for the committed metric surface and are defined centrally in the registry; do not implement generic LLM-authored compute-plan execution in this slice.
- Keep the architecture compute-ready by preserving a closed derivation seam and trace computation support, but defer metric-expression planning to a later slice.
- Use a small reusable warning taxonomy across planner and executor behavior, including subject ambiguity, unknown subjects, unsupported metrics, unsupported seasons, unsupported season types, unsupported query shapes, and nightly data unavailability.
- Expand planner support to broad season-stat lookup phrasing across players and teams, including multi-metric asks, record asks, and rating asks, while keeping the planner closed to the shipped runtime surface.
- Preserve explicit season mentions in planner output and normalize supported season strings to canonical `YYYY-YY`.
- Keep vague lookup asks like "How is Jokic doing?" as clarification-needed rather than planner guesses.
- Keep unsupported adjacent asks like standings, schedule, team comparison, splits, and predictions as coverage gaps in this slice.
- Replace the current skinny deterministic season fixtures with richer season payloads that honestly cover the supported lookup metric surface.
- Ensure direct test seeding and fixture-backed bootstrap fetching both use the same richer deterministic payload surface.
- Preserve the repo's nightly-only execution policy: supported lookup shapes succeed from stored data and return `nightly_data_unavailable` when the cache is empty.
- Keep the LLM/tool boundary explicit: the LLM consumes capabilities, asks valid structured questions, receives grounded stats/artifacts, and produces the final user-facing response itself.

## Testing Decisions

- Good tests should lock external behavior and public contracts, not implementation details. The goal is to prove what callers can ask, what they get back, how unsupported asks fail, and whether canonical provenance stays trustworthy.
- Add semantic metric registry and capability registry tests that assert the supported lookup surface is exposed consistently for validation and capability discovery.
- Add planner service tests that cover player lookup planning, team lookup planning, multi-metric planning, season normalization, clarification-needed for vague asks, and coverage gaps for unsupported adjacent asks.
- Add planner tests that prove prompt/schema support is derived from shared capabilities rather than a hand-maintained divergent list.
- Add team resolver tests for exact names, city names, nickname names, common short names, abbreviations, ambiguous aliases, and unknown teams.
- Add semantic executor tests for `lookup/player` canonical resolution, single-row output shape, multi-metric output, unsupported-metric failure, and current-season defaulting.
- Add semantic executor tests for `lookup/team` canonical resolution, single-row output shape, record-style metric retrieval, advanced metric retrieval, and multi-source merging into one row.
- Add semantic executor tests for unsupported explicit seasons and unsupported season types using the new typed warning behavior.
- Add semantic executor tests that prove lookup reads from stored league-wide season rows and fails with `nightly_data_unavailable` when the required stored payloads are missing.
- Add direct route tests for `POST /api/stats/query` covering structured player lookup, structured team lookup, ambiguous structured lookups, unsupported metrics, unsupported seasons, unsupported season types, and empty-DB nightly coverage gaps.
- Add natural-language route integration tests for `/api/query` covering supported lookup asks end to end through planner plus executor.
- Add trace tests that prove lookup traces expose canonical `resolvedQuery`, stored data freshness, source calls, warnings, and any computation metadata used by the closed derived metric surface.
- Add capabilities route tests that lock the public capability payload shape, supported output modes, metrics, seasons, season types, and subject rules.
- Add nightly bootstrap and backfill tests that prove current-season lookup source variants and `2023-24` demo backfill rows are materialized through the intended stored-data path.
- Add test coverage ensuring richer lookup fixtures are shared across direct cache seeding and bootstrap fixture fetching so the supported metric surface stays honest.
- Follow existing codebase prior art for behavior-first API route tests, semantic executor tests, trace tests, and fixture-backed nightly cache tests rather than introducing implementation-detail assertions.
- Keep all default tests deterministic and fixture-backed; do not make slice acceptance depend on live NBA or live model responses.

## Out of Scope

This PRD does not include generic LLM-authored compute-plan execution, runtime self-extension of the metric registry, automatic persistence of new formulas inferred from user prompts, graph or chart artifact generation, standings lookup, schedule lookup, roster lookup, splits, predictions, comparisons between two lookup subjects, playoff support, or arbitrary historical season support beyond `2023-24`.

It also does not include exposing internal source variants, raw NBA response fields, or endpoint parameter details through the public capabilities route. Those remain implementation details of the stored-data executor surface.

## Further Notes

Recommended tracer-bullet slice boundaries for `prd-to-issues`:

1. Semantic metric registry and shared capability registry unification.
2. Team directory and ambiguity-safe team resolution.
3. Richer deterministic season fixtures plus shared bootstrap fixture surface.
4. Nightly and historical materialization expansion for lookup source variants.
5. Semantic executor lookup support for player and team season rows.
6. Capabilities route exposure and contract tests.
7. Planner expansion to lookup phrasing sourced from shared capabilities.
8. End-to-end route, trace, and empty-DB bootstrap verification for lookup.

The core architecture choice for this PRD is deliberate: ship a broad grounded lookup substrate first, make the tool self-describing for the LLM, and prepare for future metric-expression compute without collapsing this slice into a generic program-synthesis project.
