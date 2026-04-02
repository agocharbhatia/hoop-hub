# Project Log

## 2026-04-01

- PRD drafted: `OpenAI Planner Runtime For POST /api/query In The Current Stats Domain`.
- Canonical issue: `#9`.
- Core architecture choice: add one primary natural-language planner route in front of the existing semantic executor, while keeping the structured stats route public and removing the old chat route.
- Workflow assumptions: use deterministic planner tests with a fake adapter, keep planner output closed to the current stats slice, and treat planner outages or invalid structured output as real server errors rather than typed coverage gaps.
- PRD sliced into implementation issues `#10` through `#14`, and the approved execution graph was mirrored into `.sandcastle/tasks.yaml`.
- Slice `planner_runtime_rankings` established `POST /api/query` as the new planner boundary for supported player-ranking asks, with planner output revalidated through the structured semantic contract before executor delegation.
- Planner non-ok decisions now persist semantic traces with `resolvedQuery: null` and no source calls, so unsupported coverage stays debuggable without implying execution happened.
- Slice `planner_player_trends` extends that boundary to player trends with safe planner-side metric clarification: scoring language can infer `pts`, explicit last-N windows stay in the planned query, and vague trend asks should stop with `clarification_needed` plus `missing_metric` instead of guessing.
## planner_runtime_rankings

- Title: Establish /api/query planner runtime for player rankings and typed unsupported gaps
- Module scope: planner contracts and schema, OpenAI planner adapter, planner service, query route orchestration, trace persistence for planner non-ok responses
- Interface contract: POST /api/query accepts { question: string } | public response remains StatsQueryResponse | POST /api/stats/query remains the direct structured executor route | planner outputs a closed validated decision contract before executor delegation
- Tests: add deterministic planner service tests for planned and coverage-gap decisions | add /api/query route tests for rankings, unsupported asks, and server-error behavior | keep existing executor tests green
## planner_player_trends

- Title: Add player trend planning with safe metric clarification
- Module scope: planner service, planner schema, query route tests, semantic executor integration path
- Interface contract: player trend questions plan into canonical metric ids and supported semantic filters | vague trend asks return clarification_needed with no executor call | executor remains the canonical grounding authority
- Tests: add deterministic planner tests for scoring inference and missing_metric | add /api/query route tests for supported and clarification-needed trend asks

## planner_player_comparisons

- Title: Add player comparison planning with subject-order guarantees
- Module scope: planner service, planner schema, query route tests, comparison integration path
- Interface contract: comparison asks preserve subject order from the user question | compare-without-metric defaults safely to pts | incomplete comparison asks return clarification_needed with no executor call
- Tests: add deterministic planner tests for compare planning and subject order | add /api/query route tests for compare success and compare_requires_two_subjects

## planner_team_defense_rankings

- Title: Add team defensive ranking planning to the new runtime
- Module scope: planner service, planner schema, query route tests, team ranking integration path
- Interface contract: team defensive ranking asks plan into `rank/team` with canonical `drtg` and empty subject | adjacent unsupported team asks still stop as typed `coverage_gap` responses with no executor call
- Tests: add deterministic planner tests for supported team defense planning and unsupported adjacent team asks | add `/api/query` route tests for team defense success and typed unsupported gaps
## planner_team_defense_rankings

- Title: Add team defensive ranking planning to the new runtime
- Module scope: planner service, planner schema, query route tests, team ranking integration path
- Interface contract: team defensive ranking asks plan into rank/team with canonical drtg metric | unsupported adjacent team asks still fail as typed coverage gaps | public response and trace semantics remain unchanged
- Tests: add deterministic planner tests for supported and unsupported team asks | add /api/query route tests for team defensive ranking behavior

