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
- Standard clip events map to exact NBA video measures. Custom shots filter the full shot log and join only on `(GAME_ID, GAME_EVENT_ID)`. Query playlists retain every joined link; model summaries omit full video and shot arrays, while exports retain their separate bounded limit.
- A source video link and HTTP 200 do not prove footage availability. NBA media depends on request context: research documents send only their origin, server probes/exports use consistent public GET headers, and native playback must not be gated by a bare HEAD fallback. A stable browser-only cache version repairs old fallback bytes while saved event/asset URLs remain canonical. Never substitute another event or infer global footage absence from a diagnostic response.
- Missing or malformed video join keys remain missing; never admit unrelated clips to fill a playlist.
- Named-defender requests must not silently degrade to opponent-team filtering.

## Research interface

- Design for analysts and basketball creators. Assume familiarity with standard basketball metrics; omit routine stat definitions and instructional panels.
- Two-player and two-team comparisons share paired metric rows, signed first-minus-second deltas, and compact inline supporting values. Keep the removed delta formula caption out of both UI and exports. Higher/lower direction and favorable direction are separate; do not assign favorable colors to ambiguous metrics.
- Split comparisons use canonical game logs, ordered cohorts and second-minus-first changes. Pool exact shooting counts; never average game percentages. Preserve the independent cutoff when refining overall dates. Do not offer partial-date edits for complete two-season comparisons or silently drop unsupported situational/opponent filters.
- Artifact reading order follows the question's analytical task, with stable original indices for pins and exports. Generic comparison language must not outrank an explicit trend, ranking, film, shot-map or table request.
- Table presentation follows verified metric intent and source units. Preserve canonical rows, exact precision, missing values, and access to additional fields. Never infer percentage scales from numeric magnitude.
- Scatter references and percentiles use the full qualifying source population, independently of highlights, searches, rankings or display caps. Three-point rates require exact makes/attempts and games from totals; do not reconstruct denominators from rounded rates. Trend smoothing requires a complete trailing window and labels its observation grain.
- Scatter headshots/logos must not move measured coordinates, remove points or change populations. Use canonical identity resolution and bounded image decluttering; selected/inspected subjects take priority. Portable images embed bounded same-origin media bytes, retaining initials if the CDN fails. The media endpoint must resolve known identities rather than accept arbitrary URLs.
- Board pins resolve account-owned saved artifacts on the server and retain immutable evidence snapshots plus validated view settings. Never accept client-authored evidence values or let source-history expiry remove pinned research. Exports retain scope, qualification, source and units.

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
