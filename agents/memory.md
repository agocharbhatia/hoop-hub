# Hoop Hub Engineering Memory

This file contains durable engineering rules. It is not a roadmap or issue tracker. Read `agents/current-state.md` first, then `.docs/PLAN.md`.

## Runtime boundaries

- `POST /api/query` is the product natural-language route and uses the dynamic tool-loop agent.
- `POST /api/stats/query` is the structured semantic contract and stored-data execution path.
- The legacy planner, orchestrator, answer renderer, and mock query engine are compatibility-only. Do not add product behavior there.
- The model may choose tools and presentation intent; server code owns identity resolution, endpoint validation, filtering, computation, chronology, joins, and artifact reconciliation.

## Grounding and contracts

- Canonical `resolvedQuery` data and persisted trace tool calls must describe what actually executed, not raw caller or model text.
- Conflicting IDs and names must fail before execution. Ambiguous aliases return typed clarification without pretending a canonical subject was resolved.
- Player and team aliases are explicit overlays on canonical directories; never create local one-off identity maps.
- Parser and validator errors returned to the model should be explicit enough to correct, while product presentation hides non-actionable transport diagnostics.
- Structured rows and successful tool output are the grounding authority. Model-authored artifacts are reconciled or replaced before reaching the UI.

## Data policy

- Structured semantic execution reads stored materialized endpoint data and returns typed coverage gaps when it is unavailable.
- The dynamic agent uses the cataloged endpoint client with caching and optional proxy support; it must not call NBA hosts through ad hoc code paths.
- Nightly snapshots are keyed to their slate date and resumable request state. Freshness and completeness must remain explicit.
- Fixture-backed setup and tests must share the same payload shapes as the materialization path.
- Live-network checks stay outside default deterministic CI.

## Computation and artifacts

- Derived statistics use full internal result sets. Public row display caps must never become computation caps.
- Time-series analysis sorts by canonical date before window comparisons and artifacts.
- Charts must represent the same filtered population and values quoted in the answer.
- Standard clip events map to exact NBA video measures. Custom shots filter the full shot log, join only on `(GAME_ID, GAME_EVENT_ID)`, and apply the product cap after the join.
- Missing or malformed video join keys remain missing; never admit unrelated clips to fill a playlist.
- Named-defender requests must not silently degrade to opponent-team filtering.

## Testing and release

- Default verification is `bun run check`, `bun run check:endpoint-catalog-contracts`, `bun run test`, `bun run eval`, `bun run eval:custom-shots`, and `bun run build` from `apps/web`.
- Query-facing changes require deterministic eval cases based on exact user questions, grounding invariants, artifact assertions, warning hygiene, and trace/tool assertions.
- Live eval and browser playback checks are separate release gates because deterministic tests cannot prove model behavior, NBA availability, or browser autoplay.
- A discovered correctness regression is not closed until a permanent automated test or eval captures it.

## Repository workflow

- New worktrees preserve existing environment files and bootstrap fixture-backed nightly data through the root workspace scripts.
- Persistent local databases live per worktree under `~/.hoop-hub/data/<hash>/hoop-hub.sqlite` unless `HOOP_HUB_DB_PATH` overrides the path.
- Documentation links committed to the repository must be relative and portable.
- `agents/project-log.md` is chronological history; `.docs/prds/` are historical approved requirements; neither overrides current-state documentation.
