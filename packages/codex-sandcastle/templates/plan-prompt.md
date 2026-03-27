# ISSUES

Here are the open implementation issues in the repo:

<issues-json>

!`{{ISSUE_LIST_COMMAND}}`

</issues-json>

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it blocks or is blocked by any other open issue.

An issue B is blocked by issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B depends on an API shape, schema, or project decision that A will establish

An issue is unblocked if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the format `{{BRANCH_PREFIX}}/issue-{number}-{slug}`.

# OUTPUT

Output your plan as JSON wrapped in `<plan>` tags:

<plan>
{"issues":[{"number":42,"title":"Example issue","branch":"{{BRANCH_PREFIX}}/issue-42-example-issue"}]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single best candidate with the weakest dependency chain.
