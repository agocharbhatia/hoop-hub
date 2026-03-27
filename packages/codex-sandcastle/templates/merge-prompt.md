# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. Resolve merge conflicts intelligently if they appear
3. After each merge, run:

{{VERIFY_COMMANDS_BLOCK}}

4. Fix any issues before moving to the next branch

After all successful merges, make a single summary commit if one is needed.

# CLOSE ISSUES

For each successfully merged branch, close the corresponding issue:

{{ISSUES}}

Once complete, output `<promise>COMPLETE</promise>`.
