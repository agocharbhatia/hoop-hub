# Project Log

## 2026-04-01

- PRD drafted: `OpenAI Planner Runtime For POST /api/query In The Current Stats Domain`.
- Canonical issue: `#9`.
- Core architecture choice: add one primary natural-language planner route in front of the existing semantic executor, while keeping the structured stats route public and removing the old chat route.
- Workflow assumptions: use deterministic planner tests with a fake adapter, keep planner output closed to the current stats slice, and treat planner outages or invalid structured output as real server errors rather than typed coverage gaps.
- PRD sliced into implementation issues `#10` through `#14`, and the approved execution graph was mirrored into `.sandcastle/tasks.yaml`.
