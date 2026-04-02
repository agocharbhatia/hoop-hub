# Hoop Hub Memory

## 2026-03-12

- Milestone 1 introduced `POST /api/stats/query` as the structured primary lookup contract for LLM tool use.
- The current semantic route is a legacy adapter layer, not the final architecture. Future slices should extend the semantic executor and canonical data model instead of adding new top-level legacy intents.
- Preferred product direction:
  - structured-first tool contract
  - nightly warehouse-style refresh as the default data path
  - live fallback only for current-day or in-progress coverage gaps
  - factual/statistical answers first, with event-level coverage before non-stats/media domains

## 2026-03-15

- The direct semantic executor now owns supported stats lookups end to end for player rankings, player trends, player comparisons, and team defensive rankings.
- `/api/chat/query` should remain a raw natural-language wrapper over the semantic executor, while `/api/stats/query` stays the primary structured tool contract.
- Structured responses need compact canonical rows first; prose summaries are secondary and should not be treated as the main execution artifact.
- Fixture-backed extractor tests are the preferred way to stabilize semantic result shapes before moving to a warehouse-backed executor.

## 2026-03-25

- Structured player subject validation should reject conflicting `ids` plus `names` before execution so bad tool inputs fail as `400`s instead of becoming misleading trace data.
- Canonical `resolvedQuery` data belongs at the plan boundary: resolve subject IDs/names and default filters before execution so both provenance and trace output reflect the exact query that ran.
- Persisting a vendored player-directory snapshot in product state is a safer bridge than scattering hardcoded subject lists through semantic execution logic.

## 2026-03-26

- Name-based structured player resolution needs to canonicalize both identity fields, not just IDs. If provenance or traces echo caller casing, the execution record becomes less trustworthy than the underlying directory lookup.
- When an issue is partly landed already, add missing behavior-first tests at the module and contract boundaries before assuming the remaining work is implementation. That keeps the branch scoped while still proving the acceptance criteria.
- Natural-language player extraction should preserve subject order from the user message while still using the full seeded directory. Resolver breadth without stable ordering can silently skew comparison outputs and trace provenance.
- Chat-route subject coverage should be guarded at the route boundary with arbitrary exact-name trend and comparison tests, so the natural-language wrapper cannot drift back to a smaller hardcoded player list than the structured executor.
- Request-level `allowLiveFallback` needs to gate both endpoint retrieval and directory refresh. If either path has no stored snapshot/data and live fallback is blocked, return a typed `coverage_gap` instead of falling through to extraction failures or hidden snapshot seeding.
- Structured request validation should not mutate persisted state unless the request policy allows refresh. If validation preloads the player directory, it can accidentally bypass `allowLiveFallback: false` before execution even starts.
- Curated alias coverage should live as an explicit overlay on top of the canonical directory, not as alternate canonical names. That keeps source identity data stable while still allowing product-specific shorthand and explicit ambiguity rules.
- Ambiguous alias inputs should return `clarification_needed` with the candidate canonical names and leave `resolvedQuery` unset. Once a resolver can no longer prove one canonical player, traces and provenance should stop short of pretending execution was grounded.
- Keep live-network smoke coverage outside the default `bun run test` path. The safer contract is a separate `test:live-smoke` entrypoint plus a scheduled/manual workflow, so PR mergeability stays fixture-backed while the real integration seam is still exercised.
- Sandcastle loop runs are easier to review when each cycle start and completion is framed as a prominent terminal banner instead of a plain inline log line.
- Open implementation issue sequencing currently has one clear entry point: issue #2 is the only unblocked slice because the repo still lacks a shared persisted player resolver and still duplicates player knowledge inside `query-service`, `planner/query-plan`, and `mock/query-engine`.
- Current dependency chain for issue work is `#2 -> (#3 and #5) -> #4 -> #6`, with `#7` depending on the live directory path from `#5` for a real non-blocking smoke workflow.
- Among the still-open implementation issues visible locally, `#3` and `#5` are the parallel entry points: both touch `query-service` and `player-directory`, but neither requires the other's API shape first; `#4` depends on `#3`, `#6` depends on `#4`, and `#7` depends on `#5`.
- Codex Sandcastle completion is commit-driven, not text-driven: a worker must create a branch commit before emitting `<promise>COMPLETE</promise>`, and the runner should fail fast if that token appears with zero commits ahead of base.
- Legacy planner/mock regression coverage should pin player resolution to the shared player-directory helpers, not package-script env defaults or duplicated hardcoded name maps. That keeps direct test runs deterministic and prevents resolver drift from hiding behind `bun run test`.
- Codex Sandcastle should treat Codex CLI usage-limit exits as transient orchestration state: wait through the reported reset window, then retry the same planner/worker/merger command instead of aborting the whole run.
- After a Ralph/Sandcastle loop lands a tooling package, build QA from the real git diff plus the package test surface first; that separates already-covered unit behavior from the manual integration seams that still need deliberate validation.
- When the user asks for a QA plan after a Ralph/Sandcastle run, default to a repo-local manual tester checklist they can execute themselves, not just an internal fake-harness integration matrix.
- If the Ralph loop merged app features rather than tooling, the QA plan should be anchored to the merged product behavior and route contracts first: exact-name resolution, canonical traces, alias ambiguity, fallback policy, and any isolated smoke workflow changes.

## 2026-03-27

- Codex workspace ergonomics for this repo should live in dedicated root scripts: keep `run`, `setup`, and `teardown` separate so new workspaces can install dependencies, preserve existing `.env` files, and clean only generated artifacts on exit.
- `.superset/config.json` should point its worktree lifecycle hooks at those same root scripts so new Git worktrees use one shared install/run/cleanup contract instead of drift between local tooling entrypoints.
- Ignore rules need to stay artifact-specific. Ignoring a whole workspace root like `packages/` hides real source packages from normal Git flows and causes review regressions.
- README file links must stay repo-relative so they work on GitHub and in other clones; never commit machine-local absolute paths.

## 2026-03-28

- The current app already has a deterministic semantic executor, but the remaining core-engine gaps are architectural, not cosmetic: true NL planning, persisted traces/session state, nightly-first materialization, a compute layer for derived metrics, and answer/artifact composition still need to be built.
- `sessionId` is currently validated at the chat boundary but not used to load or store conversational context. Until session grounding exists, follow-up UX is only a UI affordance, not a real engine capability.
- The repo now has two parallel query paths: the active semantic executor and a legacy mock planner/query-engine path. Future engine work should consolidate around one production query-runtime boundary rather than extending both.
- Planning context should now be read in this order: `agents/current-state.md` first for the concise engine snapshot, then `README.md` / `apps/web/README.md` for roadmap and operational details, and `agents/memory.md` for deeper historical breadcrumbs.
- The old in-repo Codex Sandcastle package and `.sandcastle/` runner assets were removed. Future agent workflow tooling for this repo should come from the standalone external `codex-sandcastle` tool plus `.superset/`, not from reviving repo-local sandbox code.

## 2026-04-01

- `options.allowLiveFallback` was removed from the structured semantic query contract. Callers should not decide request-time live fetch policy anymore.
- The semantic executor now reads stored endpoint cache rows only and returns a typed `nightly_data_unavailable` coverage gap when the nightly-backed cache is empty.
- Tests for the semantic executor and API routes should seed stored endpoint fixtures directly instead of stubbing live network fetch, so regressions in nightly-only behavior stay visible.
