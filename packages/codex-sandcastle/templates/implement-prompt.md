# TASK

Fix issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

Pull in the issue using `gh issue view #{{ISSUE_NUMBER}} {{GH_REPO_FLAG}}`. If it has a parent PRD, pull that in too.

Only work on the issue specified. Work on branch {{BRANCH}}.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXECUTION

Explore the repo first. Pay extra attention to tests touching the relevant areas.

Use red-green-refactor where it fits:

1. RED: write a test
2. GREEN: implement the smallest change to pass it
3. REPEAT until the issue is complete
4. REFACTOR without changing behavior

# FEEDBACK LOOPS

Before committing, run:

{{VERIFY_COMMANDS_BLOCK}}

# GITHUB

If the task is not complete, leave a comment on the issue describing what was done and what remains.

Do not close the issue. That happens after merge.

Once complete, output `<promise>COMPLETE</promise>`.

# FINAL RULE

ONLY WORK ON THIS ISSUE.
