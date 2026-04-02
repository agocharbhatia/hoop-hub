# Project Log

## 2026-04-01

- PRD drafted: `OpenAI Planner Runtime For POST /api/query In The Current Stats Domain`.
- Canonical issue: `#9`.
- Core architecture choice: add one primary natural-language planner route in front of the existing semantic executor, while keeping the structured stats route public and removing the old chat route.
- Workflow assumptions: use deterministic planner tests with a fake adapter, keep planner output closed to the current stats slice, and treat planner outages or invalid structured output as real server errors rather than typed coverage gaps.
- PRD sliced into implementation issues `#10` through `#14`, and the approved execution graph was mirrored into `.sandcastle/tasks.yaml`.
- Slice `planner_runtime_rankings` established `POST /api/query` as the new planner boundary for supported player-ranking asks, with planner output revalidated through the structured semantic contract before executor delegation.
- Planner non-ok decisions now persist semantic traces with `resolvedQuery: null` and no source calls, so unsupported coverage stays debuggable without implying execution happened.
## planner_runtime_rankings

- Title: Establish /api/query planner runtime for player rankings and typed unsupported gaps
- Module scope: planner contracts and schema, OpenAI planner adapter, planner service, query route orchestration, trace persistence for planner non-ok responses
- Interface contract: POST /api/query accepts { question: string } | public response remains StatsQueryResponse | POST /api/stats/query remains the direct structured executor route | planner outputs a closed validated decision contract before executor delegation
- Tests: add deterministic planner service tests for planned and coverage-gap decisions | add /api/query route tests for rankings, unsupported asks, and server-error behavior | keep existing executor tests green

