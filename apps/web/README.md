# Hoop Hub Web App

SvelteKit frontend + server routes for the Hoop Hub local POC.

## Scripts

```bash
bun run dev
bun run check
bun run test
bun run build
```

## Current API Routes

- `GET /api/health`
- `POST /api/chat/query`
- `GET /api/query-trace/:traceId`

## Notes

- Current query execution is retrieval-backed, but only partially grounded:
  - `league_leaders` composes answers from retrieved NBA payloads
  - `player_trend`, `player_compare`, and `team_ranking` still return templated summaries after retrieval
- The current runtime is live-fetch-first with cache fallback; finalized nightly-first ingestion is not implemented yet.
- Root project status and roadmap live in the repository [README](../../README.md).
