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
