# Hoop Hub Memory

## 2026-03-12

- Milestone 1 introduced `POST /api/stats/query` as the structured primary lookup contract for LLM tool use.
- The current semantic route is a legacy adapter layer, not the final architecture. Future slices should extend the semantic executor and canonical data model instead of adding new top-level legacy intents.
- Preferred product direction:
  - structured-first tool contract
  - nightly warehouse-style refresh as the default data path
  - live fallback only for current-day or in-progress coverage gaps
  - factual/statistical answers first, with event-level coverage before non-stats/media domains
