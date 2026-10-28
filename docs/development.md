# Development

Run commands from `apps/web` unless a section says otherwise. Use Node 22.19+ and Bun 1.3.14, matching the primary CI workflow and Docker build.

## Preview without credentials

```bash
bun install --frozen-lockfile
bun run demo
```

Open **http://127.0.0.1:4173/dev/research**. The preview uses the real UI with synthetic comparison, split, team, and shooting fixtures. The page labels them as synthetic. `/dev/charts` provides additional chart interactions.

The command sets local authentication, disables live source retrieval, enables the fixture lab, and uses `.data/demo.sqlite`. Keep that database separate from real research: opening the lab seeds synthetic endpoint caches. The ordinary question box at `/` is not a scripted natural-language demo; use the fixture lab for the credential-free preview.

## Natural-language research

```bash
cp .env.example .env
```

Set both `OPENAI_API_KEY` and `OPENAI_AGENT_MODEL` in `.env`, then:

```bash
bun run dev --host 127.0.0.1
```

Open the loopback URL printed by Vite. The model must support the tool-calling and structured-output requests used by the adapter. Requests to the natural-language route incur usage on the configured model account. Live-source retrieval is enabled by default; `HOOP_HUB_NBA_PROXY_URL` can supply a proxy when direct NBA Stats access is unavailable.

The ordinary database defaults to a per-workspace file under `~/.hoop-hub/data/<hash>/hoop-hub.sqlite`. Set `HOOP_HUB_DB_PATH` for another location. Starting development without `HOOP_HUB_UI_FIXTURES=1` keeps the synthetic lab unavailable. Node loads `apps/web/.env`; keep credentials in ignored environment files.

PBP Stats provides the possession/lineup adapter. Internal local research and external display have distinct configuration checks. See the [environment template](../apps/web/.env.example) and [deployment environment](../deploy/beta.env.example) for those settings.

## Structured queries without a model

The structured runtime uses materialized data rather than falling back to live requests. Bootstrap a disposable fixture database and serve it with NBA retrieval disabled:

```bash
HOOP_HUB_DB_PATH=.data/structured-demo.sqlite bun run nightly:bootstrap -- --fixture-data --slate-date 2026-04-01
HOOP_HUB_DB_PATH=.data/structured-demo.sqlite HOOP_HUB_ENABLE_LIVE_NBA=0 HOOP_HUB_ENABLE_LIVE_PBPSTATS=0 bun run dev --host 127.0.0.1 --port 4173
```

The fixed date pins this example to the historical fixture surface. It does not establish current NBA results. Inspect `GET /api/stats/capabilities` for the current typed contract. Empty or uncovered materializations return typed coverage gaps.

For real source materialization, use another database and omit `--fixture-data`:

```bash
HOOP_HUB_DB_PATH=.data/research.sqlite bun run nightly:bootstrap -- --slate-date YYYY-MM-DD
HOOP_HUB_DB_PATH=.data/research.sqlite bun run nightly:audit -- --slate-date YYYY-MM-DD
```

Replace `YYYY-MM-DD` with the intended slate date. The bootstrap records per-request progress and can reuse valid stored work. Audit reports distinguish finalized, provisional, stale, and unavailable snapshots. Use [the live-bootstrap helper](../scripts/bootstrap-live-data.sh) only when intentionally resetting the default workspace database: that helper deletes the existing database and WAL files first.

## Verification

```bash
bun run check:repo
bun run check
bun run check:endpoint-catalog-contracts
bun run test
bun run eval
bun run eval:custom-shots
bun run build
```

Default tests use an in-memory database and disable live NBA and PBP Stats requests. Local evaluations use scripted model turns and synthetic endpoint fixtures. None of these commands needs model credentials. Build verification includes launching the relocated NBA transport assets.

`check:endpoint-catalog-contracts` requires network access to compare the catalog with upstream `nba_api` documentation on GitHub. It is separate from the offline test and evaluation suites.

`bun run beta:smoke` exercises the built production HTTP server with a local model fixture. Install `ffmpeg` and `ffprobe` for the full media runtime check. To reproduce the container checks from the repository root:

```bash
docker build --tag hoop-hub-beta:local .
cd apps/web
bun run beta:container-smoke
```

See [engineering evidence](engineering-evidence.md) for the distinction between offline contracts, frozen real-data oracles, model evaluation, and live acceptance.

## API entrypoints

| Route | Purpose |
| --- | --- |
| `POST /api/query` | `{ question, sessionId? }`; JSON or SSE with `Accept: text/event-stream`. |
| `POST /api/stats/query` | Validated structured semantic execution. |
| `GET /api/stats/capabilities` | Supported structured query shapes and metrics. |
| `GET /api/query-trace/:traceId` | Owned dynamic or structured trace. |
| `GET /api/research` | Owned saved research; session routes handle individual histories. |
| `POST /api/research/refine` | Server-side refinements of an owned saved result. |
| `/api/boards` | Owned research boards and saved artifact snapshots. |
| `/api/clip-exports` | Compilation and retrieval of verified saved playlists. |
| `GET /api/health`, `GET /api/ready` | Process health and deployment readiness. |

Mutating requests must include an `Origin` header matching the app origin, including requests sent with `curl`. In deployed modes, private routes also require an authenticated session cookie. Never put a model key in a browser request.

## Public deployment

The repository supports local, invite, and public visitor modes. Public visitor mode still assigns each browser its own private research identity. Production defaults to invite mode. Development fixture routes are unavailable outside local mode.

Use the [deployment runbook](../.docs/BETA_DEPLOYMENT.md) for Compose, persistent volumes, invitations, source-display configuration, backups, and restore. A green health endpoint alone does not verify model access, data access, or video playback. Complete the documented hosted checks before sharing a running demo.

## Repository conventions

Keep credentials, databases, generated eval reports, browser captures, and editor/agent scratch state out of commits. Curated documentation images belong in `docs/assets/`. Keep behavioral tests beside the code they exercise, and prefer regressions that demonstrate a real failure mode over assertions that repeat the implementation.

Add new natural-language behavior to the dynamic agent or a focused computation module. Preserve the distinction between retrieved evidence, canonical computation, and model-authored prose. Keep helper sections visibly bracketed and use docstrings to explain non-obvious boundaries and decisions.
