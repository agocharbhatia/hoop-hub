# Hoop Hub Web App

SvelteKit frontend + server routes for the Hoop Hub local POC.

## Scripts

```bash
bun run dev
bun run check
bun run test
bun run test:live-smoke
bun run build
```

## Environment

- Planner runtime configuration should be set in `apps/web/.env` for local development.
- Required planner variables:
  - `OPENAI_API_KEY`
  - `OPENAI_PLANNER_MODEL`

## Current API Routes

- `GET /api/health`
- `POST /api/query`
- `POST /api/stats/query`
- `GET /api/query-trace/:traceId`

## Notes

- Current query execution is semantic-executor-backed for the supported statistical shapes:
  - player rankings
  - player trends
  - player comparisons
  - team defensive rankings
- `POST /api/query` is the primary natural-language planner route in front of the same semantic executor used by `POST /api/stats/query`.
- Traces now expose canonical `resolvedQuery` data, source calls, cache/freshness details, and warnings instead of relying on legacy planner output.
- Player resolution uses the shared seeded player-directory snapshot plus curated aliases; future engine work should reuse that path instead of embedding local name maps.
- Semantic query execution now reads stored endpoint payloads only; finalized nightly ingestion/materialization is not implemented yet, so missing stored data still returns typed coverage gaps.
- The legacy mock planner/query-engine remains in the repo for compatibility tests, but new execution behavior should be added to the semantic executor path, not the legacy path.
- The live smoke path is isolated from default PR CI and runs through `.github/workflows/live-smoke.yml`.
- Root project status and roadmap live in the repository [README](../../README.md).
- A compact source-of-truth for future agents lives in [../../agents/current-state.md](../../agents/current-state.md).
- The current slice-2 PRD mirror lives in [../../.docs/prds/nightly-stats-materialization-bootstrap-slice-2.md](../../.docs/prds/nightly-stats-materialization-bootstrap-slice-2.md).
