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
- The current runtime is still live-fetch-first with cache fallback; finalized nightly-first ingestion/materialization is not implemented yet.
- The legacy mock planner/query-engine remains in the repo for compatibility tests, but new execution behavior should be added to the semantic executor path, not the legacy path.
- The live smoke path is isolated from default PR CI and runs through `.github/workflows/live-smoke.yml`.
- Root project status and roadmap live in the repository [README](../../README.md).
- A compact source-of-truth for future agents lives in [../../agents/current-state.md](../../agents/current-state.md).
