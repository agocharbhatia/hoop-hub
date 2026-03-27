# Codex Sandcastle

A small issue-loop runner inspired by Matt Pocock's `.sandcastle` workflow, but wired to the local `codex` CLI instead of Claude Code.

## What It Does

- plans unblocked GitHub issues with a planner agent
- runs one Codex worker per issue in isolated git worktrees
- merges completed branches with a merger agent
- keeps prompts project-local in `.sandcastle/`

## Package Layout

- `src/` contains the reusable runner
- `templates/` contains generic `.sandcastle` scaffolding for new projects

## Usage In A Project

Install it into the project first, either from a published registry or directly from a local path.

Example local install:

```bash
npm install --save-dev /absolute/path/to/codex-sandcastle
```

Or with Bun:

```bash
bun add -d /absolute/path/to/codex-sandcastle
```

1. Scaffold the local `.sandcastle` folder:

```bash
npx codex-sandcastle init
```

2. Edit `.sandcastle/config.json`:

- set verification commands
- set the GitHub repo or issue label if needed
- adjust Codex model and sandbox settings if desired

3. Run the loop:

```bash
npx codex-sandcastle run --config .sandcastle/config.json
```

## Notes

- In YAML-free mode, the loop is driven entirely by GitHub issues.
- The runner only merges branches whose worker produced commits and emitted `<promise>COMPLETE</promise>`.
- Worktrees and logs are kept under `.sandcastle/` for inspection.
