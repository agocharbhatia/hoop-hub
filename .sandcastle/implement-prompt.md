You are implementing one approved AFK slice inside the current project worktree.

Task ID: {{TASK_ID}}
Task Title: {{TASK_TITLE}}
GitHub Issue: {{TASK_GITHUB_ISSUE}}
Parent PRD Issue: {{TASK_PRD_ISSUE}}
Summary:
{{TASK_SUMMARY}}

Blocked By:
{{TASK_BLOCKED_BY}}

Module Scope:
{{TASK_MODULE_SCOPE}}

Interface Contract:
{{TASK_INTERFACE_CONTRACT}}

Acceptance Criteria:
{{TASK_ACCEPTANCE_CRITERIA}}

Test Plan:
{{TASK_TEST_PLAN}}

Quality Gates:
{{TASK_QUALITY_GATES}}

Additional Notes:
{{TASK_NOTES}}

Rules:
- Treat `.sandcastle/tasks.yaml` as the execution graph and the linked GitHub issue as the long-form slice spec.
- If `GitHub Issue` is non-empty, fetch and read it with comments before implementing the task. Use it to recover nuance that may be compressed in `tasks.yaml`.
- If the GitHub issue and task file appear to conflict, preserve the task graph ordering/dependencies from `tasks.yaml` and treat the issue body as the detailed implementation brief unless there is a newer explicit clarification in the issue thread.
- If `Parent PRD Issue` is non-empty and the task issue is missing needed context, read the parent PRD issue or local mirrored PRD before broad implementation.
- Read `agents/current-state.md` before relying on older roadmap or legacy planner code.
- Read `.sandcastle/testing-standards.md` before planning the slice test approach.
- Use the linked GitHub issue, local mirrored PRDs under `.docs/prds/`, and `agents/current-state.md` as the main planning context for slice intent and boundaries.
- Keep server-owned tools and the semantic executor as grounding authorities. Do not move canonical identity resolution, computation, joins, or artifact truth into model-authored output.
- Do not add new product behavior to the legacy mock planner/query-engine path unless the task explicitly requires compatibility coverage.
- Keep `POST /api/stats/query` public as the direct structured executor route.
- Follow TDD for non-trivial behavior: derive a concrete slice test matrix from the task acceptance criteria, then add or update behavior-first tests before broad implementation.
- For query-facing slices, explicitly derive `query_acceptance_examples` and `answer_quality_expectations` from the task before broad implementation, even if the issue body did not spell them out cleanly.
- Prefer deterministic tests with fakes over live-model assertions.
- Planner service tests with mocked adapter outputs and `/api/query` tests with injected planner decisions are not sufficient on their own for query-facing slices.
- If the slice changes `/api/query`, supported query shapes, tool selection, answer/artifact composition, or query traces, add or update data-defined cases in `apps/web/src/lib/server/eval/` using the exact supported phrasings for the slice.
- Query smoke is not complete unless at least one assertion checks answer quality, not just tool shape or status. Assert the answer sounds natural for the supported ask and handles limitations honestly when relevant.
- Keep deterministic agent evaluation fixture-backed and network-free. Use `bun run eval:live` only as a separate, explicit release gate.
- For library or API integration details, use up-to-date official documentation rather than guessing.
- Work only on this task.
- Preserve existing behavior outside the task scope.
- Prefer simple, modular, strictly typed code.
- Add or update tests before broad implementation when the behavior is non-trivial.
- Run the relevant checks before finishing. The default full gate is documented in `.docs/RELEASE_CHECKLIST.md`.
- Update `agents/project-log.md` with a short note only if the task materially changes architecture, workflow assumptions, or introduces a lesson worth preserving.
- Do not update the task file yourself.
- Do not create a PR.
- Create a git commit for the completed task before finishing.
- When the task is complete and verified, output exactly {{COMPLETION_SIGNAL}} in the final message.
