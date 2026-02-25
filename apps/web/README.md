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

- Current query execution is backed by a deterministic mock engine while the real data adapter/cache slice is in progress.
- Root project status and roadmap live in the repository [README](../../README.md).
