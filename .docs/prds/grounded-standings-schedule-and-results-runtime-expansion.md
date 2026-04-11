# PRD: Grounded Standings Schedule And Results Runtime Expansion

- Status: Published
- GitHub Issue: [#43](https://github.com/agocharbhatia/hoop-hub/issues/43)

## Problem Statement

Hoop Hub can already answer a narrow set of grounded player and team season-stat questions, but it still cannot answer several of the most normal NBA questions a user expects from a factual basketball assistant. From the user's perspective, asks like "Who is first in the East?", "What seed are the Lakers?", "Who do the Celtics play next?", "Did Denver win last night?", or "What's Boston's record and who do they play next?" are all core product behavior. Today, those asks fail because the runtime has no first-class standings shape, no first-class grounded team game shape, no canonical materialization path for standings or scoreboard data, and no batch composition behavior tuned for this domain.

That gap is not just about missing prompt examples. It is an architectural gap. The current semantic executor and capability registry are still biased toward season stats, rankings, comparisons, and trends. If Hoop Hub expands standings and team game support by adding more handwritten planner branches or one-off answer logic, the runtime will become brittle and hard to extend. The product needs a durable semantic substrate for standings and team-game questions so that future season expansion mostly becomes a data-range problem instead of a prompt-maintenance problem.

The runtime also needs to stay honest while becoming more dynamic. Users should not get generic coverage-gap failures when the system can still provide a grounded partial answer, but the tool layer also must not silently pretend missing data is complete. This slice therefore needs canonical completeness semantics, explicit grounding of date language, and traces that remain trustworthy when mixed questions fan out into multiple structured requests.

## Solution

Expand the shared semantic runtime with two first-class grounded shapes: `standings/team` and `game/team`. `standings/team` becomes the semantic home for standings-native facts such as seed, rank, record, games back, streak, and related standings-state fields across the currently supported seasons. `game/team` becomes the semantic home for grounded team schedule and result rows, driven by canonical date grounding and team-scoped game retrieval. `lookup/team` remains the home for season-stat metrics so the runtime keeps one semantic home per fact family.

The runtime should stay tool-first and capability-driven. `POST /api/stats/query` remains the single structured tool boundary, and `/api/query` continues to orchestrate a bounded batch of those structured requests. Planner expansion should come from the shared capability contract rather than from new handwritten prompt families. Mixed asks such as record plus next game should decompose into multiple minimal grounded structured requests, and the answer renderer should compose the final response from those tool results.

The slice should also add a nightly/bootstrap materialization path for standings snapshots and the current scoreboard horizon, support current season plus `2023-24` standings, normalize temporal language in `America/New_York`, and introduce generic completeness metadata on structured results so the app can stay dynamic without sacrificing honesty.

## User Stories

1. As a Hoop Hub user, I want to ask who is first in the East, so that I can get a direct standings answer instead of a coverage gap.
2. As a Hoop Hub user, I want to ask what seed the Lakers are, so that team-specific standings questions feel first-class.
3. As a Hoop Hub user, I want to ask what seed the Celtics were in `2023-24`, so that supported historical standings questions work naturally.
4. As a Hoop Hub user, I want to ask for a team's record, so that common standings questions do not require season-stat phrasing.
5. As a Hoop Hub user, I want to ask how many games back a team is, so that standings context is grounded and explicit.
6. As a Hoop Hub user, I want to ask for a team's streak, so that current standings-state questions are supported.
7. As a Hoop Hub user, I want to ask which team had the longest win streak in `2023-24`, so that league-scoped standings ranking works over standings-native fields.
8. As a Hoop Hub user, I want to ask for home and road record through standings, so that standings-state splits are available without overloading season-stat lookup.
9. As a Hoop Hub user, I want to ask who do the Celtics play next, so that upcoming opponent questions are grounded and direct.
10. As a Hoop Hub user, I want to ask whether Denver won last night, so that recent game-result questions are covered.
11. As a Hoop Hub user, I want to ask who a team plays tomorrow, so that near-term schedule questions work through grounded date resolution.
12. As a Hoop Hub user, I want to ask for a team's next three games, so that bounded forward-looking schedule ranges are supported.
13. As a Hoop Hub user, I want to ask for games this weekend, so that natural bounded ranges can be grounded into calendar windows.
14. As a Hoop Hub user, I want "last night" to mean the actual previous calendar day, so that game-result answers are trustworthy.
15. As a Hoop Hub user, I want "next game" to mean the next scheduled game, so that the product behaves naturally for team schedule asks.
16. As a Hoop Hub user, I want a response like "Boston did not play on that date" when a strict calendar-relative question lands on a non-game day, so that the app remains honest instead of silently rewriting my question.
17. As a Hoop Hub user, I want mixed questions like "What's Boston's record and who do they play next?" to work in one answer, so that the product feels coherent rather than narrowly single-query.
18. As a Hoop Hub user, I want mixed standings-plus-lookup-plus-game questions to use grounded facts from each domain, so that one question can combine adjacent supported facts.
19. As a Hoop Hub user, I want unsupported clauses like injuries or predictions to stay out of the answer, so that the assistant does not bluff adjacent unsupported content.
20. As a Hoop Hub user, I want the app to still answer the supported part of a mixed question when an unsupported clause is non-essential, so that one unsupported aside does not block a useful grounded answer.
21. As a Hoop Hub user, I want explicit warnings when the system intentionally omits a non-essential unsupported clause, so that I can trust what was and was not answered.
22. As a Hoop Hub user, I want the answer route to remain dynamic when only partial grounded game coverage exists, so that the product can still be helpful without lying.
23. As a Hoop Hub user, I want the answer to say when only some requested future games were returned because only that many remain in the season, so that "next N games" behaves naturally.
24. As a Hoop Hub user, I want the answer to say when some grounded game rows are available but stored coverage is incomplete, so that partial data is not presented as complete.
25. As a Hoop Hub user, I want traces for standings and game answers to show the actual normalized query, so that I can inspect how the system grounded my ask.
26. As a Hoop Hub user, I want mixed `/api/query` traces to show the planned structured requests rather than a fake single resolved query, so that debugging remains trustworthy.
27. As a structured API caller, I want `POST /api/stats/query` to accept direct standings requests, so that I can call the stats tool without natural-language planning.
28. As a structured API caller, I want `POST /api/stats/query` to accept direct team game requests, so that programmatic callers can query schedules and results in the same contract.
29. As a structured API caller, I want standings and game requests to reuse the same validator and trace semantics as existing shapes, so that tool integrations stay consistent.
30. As a structured API caller, I want canonical team identity reflected in `resolvedQuery`, so that structured provenance shows exactly which grounded subject ran.
31. As an LLM orchestrator, I want the shared capability contract to advertise the new standings and game shapes, so that planning expands from one source of truth instead of prompt folklore.
32. As an LLM orchestrator, I want query-shape planning metadata to stay machine-readable, so that the planner can discover the new shapes without manual family lists.
33. As an LLM orchestrator, I want the contract to expose standings-native field ids, so that I can ask for seed, record, games back, or streak safely.
34. As an LLM orchestrator, I want the contract to expose game field ids and new game-status filters, so that I can ask for upcoming versus final games safely.
35. As an LLM orchestrator, I want conference and division filter support advertised explicitly, so that East/West and division-scoped standings asks are typed rather than guessed.
36. As an LLM orchestrator, I want the planner to ground natural-language time into canonical dates and game status instead of passing raw phrases into the executor, so that execution stays deterministic.
37. As an LLM orchestrator, I want mixed standings and game asks to decompose into multiple minimal requests, so that I do not need an overloaded combo shape.
38. As an executor developer, I want `standings/team` and `game/team` extracted into dedicated modules, so that query-service glue stays small and future domain growth does not deepen the monolith.
39. As an executor developer, I want `standings/team` to be the only semantic home for standings-native facts, so that record/seed/streak questions do not drift back into `lookup/team`.
40. As an executor developer, I want `lookup/team` to stay the home for season-stat metrics, so that there is one semantic home per fact family.
41. As an executor developer, I want standings-field support to be driven by a closed shared registry, so that league-scoped standings ranking is capability-driven rather than hardcoded.
42. As an executor developer, I want per-field default sort direction metadata for standings fields, so that league-scoped standings rankings can sort correctly without shape-wide hacks.
43. As an executor developer, I want `game/team` to use one normalized row contract for both upcoming schedule rows and final result rows, so that renderer and traces can stay simple.
44. As an executor developer, I want canonical completeness metadata on structured results, so that the renderer can describe partial materialization or season exhaustion without guessing from warning text.
45. As an executor developer, I want `scoreboardv2` to be the canonical current-window game source, so that upcoming and final game rows come from one coherent source seam.
46. As a nightly data developer, I want default bootstrap to materialize current standings and `2023-24` standings in the same run, so that supported historical standings work immediately after bootstrap.
47. As a nightly data developer, I want default bootstrap to materialize a current scoreboard horizon, so that recent and upcoming team game questions succeed without live fetches.
48. As a nightly data developer, I want historical game-day backfill to stay out of the default bootstrap path, so that workspace setup remains bounded while the public contract remains future-proof.
49. As a nightly data developer, I want future season expansion to mostly mean expanding supported seasons and materialization range, so that the architecture scales by data coverage rather than prompt branching.
50. As a QA engineer, I want failing tests first for capabilities, validation, execution, bootstrap, routing, and traces, so that the new slice lands through TDD instead of ad hoc implementation.
51. As a QA engineer, I want coverage for strict calendar-relative semantics and game-relative semantics, so that "last night" and "next game" cannot silently regress into the same behavior.
52. As a QA engineer, I want coverage for mixed-batch answers with standings plus game requests, so that the answer route proves the new domain integration path.
53. As a QA engineer, I want coverage for completeness metadata and partial-materialization behavior, so that dynamic answers remain grounded and explicit.
54. As a QA engineer, I want coverage for dropped unsupported-clause warnings, so that dynamic partial support does not silently mutate user intent.
55. As a future engineer, I want the standings and game runtime to be added through the same capability, validator, executor, bootstrap, and trace seams as the existing stats runtime, so that future domains follow one architecture instead of creating special cases.

## Implementation Decisions

- Add a new first-class semantic operation `standings` and a new first-class shape `game/team` to the shared semantic runtime.
- Keep `POST /api/stats/query` as the single public structured tool boundary and keep the internal tool name `stats_query`; do not introduce separate public tools for standings or games.
- Keep `/api/query` as an answer-first orchestrator over that same structured tool boundary.
- Preserve the existing capability-driven architecture: planner growth should come from the shared capability contract, not from handwritten prompt branching by family.
- Keep `lookup/team` as the semantic home for season-stat metrics; do not let standings-state facts or game facts leak into lookup.
- Make `standings/team` the semantic home for standings-native facts only, including rank/seed, record, games back, streak, and standings-state splits.
- Allow `standings/team` to support both:
  - one-team standings lookup with exactly one subject
  - league-scoped standings ranking with zero subject and optional conference/division filters
- Keep multi-team standings comparison out of scope for this slice.
- Keep `game/team` limited to exactly one team subject in this slice; do not expand into league-wide scoreboard questions with no team subject.
- Use one normalized `game/team` row contract for both upcoming and final rows so schedule and results share the same semantic output shape.
- Keep the existing `metrics` field name in the structured contract, but treat it as the closed requested-field registry for the new shapes as well.
- Continue returning canonical identity columns automatically in result rows; requested field ids select the additional returned facts.
- Extend the shared capability registry so field ids can carry per-field planning metadata, including default sort direction where needed for standings rankings.
- Extend the public capability surface to advertise the new shapes, their subject rules, supported field ids, and new filters.
- Add new structured filters:
  - `conference`
  - `division`
  - `gameStatus`
- Validate `conference` against `East | West`.
- Validate `division` against the six NBA divisions.
- Validate `gameStatus` against `upcoming | final | any`.
- Keep relative date language out of the structured contract. The planner must ground language like `today`, `tomorrow`, `last night`, `this weekend`, and `next game` into canonical filters before execution.
- Use `America/New_York` as the canonical timezone for temporal grounding in this slice.
- Lock temporal semantics:
  - calendar-relative phrases are strict to the anchored calendar date or date range
  - game-relative phrases such as `next game` and `previous game` are chronological
- Keep "team did not play on that date" as a valid grounded answer for strict calendar-relative asks that map to a non-game day.
- Define `seed` as the published conference/playoff rank from the standings source; do not compute alternate playoff-seed interpretations or tie-break outcomes in this slice.
- Keep standings seasons limited to `current` and `2023-24` for now, with the architecture deliberately shaped so future season expansion is mostly a data-range expansion.
- Keep `game/team` designed for future broader date support, but only require current-window/current-season materialized execution in this slice.
- Use `scoreboardv2` as the canonical `game/team` source for the current-window runtime in this slice.
- Use the dedicated published standings source as the canonical `standings/team` source and ground standings facts directly from that payload rather than deriving them from game rows.
- Extend bootstrap/nightly planning to materialize:
  - current standings
  - `2023-24` standings
  - the current scoreboard horizon for recent/upcoming team game support
- Do not include historical game-day backfill in the default bootstrap path for this slice.
- Keep historical relative-game phrasing unsupported; broader historical `game/team` support can be added later through explicit date-grounded backfill.
- Preserve the existing answer-route batch policy:
  - top-level `/api/query` remains `ok` if at least one structured tool result is usable
  - zero-success batches collapse to one typed non-ok response
- Decompose mixed questions into multiple minimal structured requests rather than inventing combo shapes or over-returning executor fields.
- Allow the planner to drop clearly non-essential unsupported clauses from a mixed ask, but only with an explicit orchestration-level warning; never replace an unsupported clause with a guessed supported one.
- Add generic completeness metadata to structured results rather than forcing every incomplete case into warnings or top-level non-ok status.
- Put completeness metadata on `StatsQueryResult` itself, not in provenance.
- Minimal completeness payload for this slice:
  - `coverageStatus`
  - `requestedCount`
  - `returnedCount`
- Allow `coverageStatus` to distinguish at least:
  - `complete`
  - `season_exhausted`
  - `partial_materialized`
- Treat "only N games remain in the season" as grounded success rather than coverage gap.
- Allow `game/team` to return `ok` plus explicit completeness metadata when some grounded rows are available but the requested breadth is not fully satisfied.
- Keep warnings as auxiliary signals; renderer semantics for completeness should come from structured completeness fields rather than reverse-engineered warning strings.
- Refactor the executor boundary as part of this slice by extracting shape-specific planning/request/extraction modules for `standings/team` and `game/team` instead of continuing to deepen one monolithic query-service module.
- Preserve trace honesty:
  - semantic traces for structured requests keep canonical `resolvedQuery`
  - orchestration traces keep planned tool requests and executed structured trace ids
  - orchestration traces must not fabricate a single `resolvedQuery`
- Preserve the repo's nightly-backed execution policy. The new shapes should read stored materialized payloads rather than using request-time live fetch.

## Testing Decisions

- Good tests should verify public behavior, typed contracts, grounding semantics, completeness semantics, and trace honesty rather than internal implementation details.
- Follow the repo's existing behavior-first prior art for capability tests, structured validator tests, semantic executor tests, route tests, nightly/bootstrap tests, and trace tests.
- Write failing tests before wider implementation for the new contract and runtime seams.
- Add capability-registry tests that lock:
  - the new `standings` operation
  - the new `game/team` shape
  - the new field ids
  - the new filter enums
  - any per-field planning metadata needed for standings sort defaults
- Add capabilities-route tests that prove the public capability payload advertises the new shapes and filter support without exposing implementation-only source details.
- Add structured-validator tests for:
  - `standings/team` subject rules
  - `game/team` subject rules
  - new filter validation
  - supported-season acceptance and rejection
  - invalid standings/game field ids
- Add semantic executor tests for `standings/team` covering:
  - one-team standings lookup
  - league-scoped standings ranking
  - conference and division filtering
  - supported current season and `2023-24`
  - canonical resolved team identity
  - nightly coverage gaps when snapshots are missing
- Add semantic executor tests for `game/team` covering:
  - next game
  - previous/final game
  - strict calendar-relative day asks
  - bounded ranges
  - no-game-day answers
  - completeness metadata for `complete`, `season_exhausted`, and `partial_materialized`
- Add answer-renderer tests that prove mixed standings/game/stats tool results render grounded prose from structured completeness metadata rather than warning-string heuristics.
- Add `/api/query` route and integration tests covering:
  - standings-only questions
  - game-only questions
  - mixed standings plus game questions
  - dropped unsupported-clause warnings
  - partial answers that remain top-level `ok`
- Add `/api/query-trace` tests covering:
  - honest orchestration traces for new mixed batches
  - no fake single `resolvedQuery`
  - persistence of dropped-clause warnings
- Add nightly/bootstrap tests covering:
  - current standings materialization
  - `2023-24` standings materialization
  - current scoreboard-horizon materialization
  - honest empty-DB gaps before bootstrap
  - recovery to `ok` after bootstrap
- Preserve deterministic fixture-backed default tests; do not make this slice depend on live NBA or live planner calls in the default suite.
- Prior art for the relevant behavior-first test style already exists in the repo's capability-registry tests, semantic query-service tests, `/api/query` integration tests, nightly bootstrap tests, and trace route tests. New tests should mirror those boundaries.

## Out of Scope

This PRD does not include injuries, news, clips, predictions, betting, memory, broad freeform game analysis, league-wide scoreboard questions without a team subject, multi-team standings comparisons, arbitrary season expansion beyond `current` and `2023-24`, default historical game-day backfill, playoff-seed tie-break computation, or general season-stat metric support inside `standings/team`.

It also does not include creating separate public tools for standings or games, broad historical `game/team` relative-date semantics, chart artifacts, or a second planner/runtime path outside the existing structured semantic tool boundary.

## Further Notes

Recommended tracer-bullet slice boundaries for `prd-to-issues`:

1. Expand the semantic contracts and shared capability registry for `standings/team`, `game/team`, new filters, and completeness metadata.
2. Add red tests and executor-module extraction seams for the new standings and game shapes.
3. Implement `standings/team` execution, normalization, and trace support from the dedicated standings source.
4. Implement `game/team` execution, temporal grounding support, completeness behavior, and trace support from `scoreboardv2`.
5. Expand nightly/bootstrap planning and fixture support for current standings, `2023-24` standings, and current scoreboard horizon.
6. Expand planner support from shared capabilities for standings and game questions, including mixed-batch decomposition and dropped-clause warnings.
7. Expand answer rendering and `/api/query` integration coverage for mixed standings/stats/game answers.
8. Lock end-to-end route, bootstrap, and trace coverage for empty-DB gaps, post-bootstrap success, and canonical provenance.

The core architecture choice is deliberate: add standings and team games as first-class semantic shapes under the existing structured tool boundary, keep one semantic home per fact family, and let future season expansion come primarily from broader materialized coverage rather than from more handwritten natural-language slices.
