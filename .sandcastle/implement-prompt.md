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
- Use the linked GitHub issue, local mirrored PRDs under `.docs/prds/`, and `agents/current-state.md` as the main planning context for slice intent and boundaries.
- Keep the semantic executor as the grounding and execution authority. Do not move canonical player resolution into the planner.
- Do not add new product behavior to the legacy mock planner/query-engine path unless the task explicitly requires compatibility coverage.
- Keep `POST /api/stats/query` public as the direct structured executor route.
- Follow TDD for non-trivial behavior: add or update behavior-first tests before broad implementation.
- Prefer deterministic tests with fakes over live-model assertions.
- For library or API integration details, use up-to-date official documentation rather than guessing.
- Work only on this task.
- Preserve existing behavior outside the task scope.
- Prefer simple, modular, strictly typed code.
- Add or update tests before broad implementation when the behavior is non-trivial.
- Run the relevant checks before finishing.
- Update `agents/project-log.md` with a short note only if the task materially changes architecture, workflow assumptions, or introduces a lesson worth preserving.
- Do not update the task file yourself.
- Do not create a PR.
- Create a git commit for the completed task before finishing.
- When the task is complete and verified, output exactly {{COMPLETION_SIGNAL}} in the final message.
