# Release Checklist

Use this checklist for changes to query interpretation, data retrieval, computation, artifacts, clips, presentation, or runtime configuration.

## Required deterministic gates

From `apps/web`:

```bash
bun ci
bun run check
bun run check:endpoint-catalog-contracts
bun run test
bun run eval
bun run eval:custom-shots
bun run build
```

- `git diff --check` passes.
- New behavior has fixture-backed coverage at the owning module and public contract boundary.
- Query-facing behavior has a stable eval case with prompt variants and grounding assertions.
- Answer values, artifact populations, warnings, and trace tool calls agree.
- No raw transport, retry, proxy, row-cap, or parser diagnostics leak into successful product answers.

For materialization changes, bootstrap a fixture slate and audit it explicitly:

```bash
HOOP_HUB_DB_PATH=/tmp/hoop-hub-release.sqlite bun run nightly:bootstrap -- --fixture-data --slate-date 2026-04-01
HOOP_HUB_DB_PATH=/tmp/hoop-hub-release.sqlite bun run nightly:audit -- --slate-date 2026-04-01 --as-of 2026-04-01T12:00:00.000Z
```

## Required live gates for query-facing releases

First run real-model interpretation against strictly scoped frozen fixtures, then validate real NBA responses separately. Configure `HOOP_HUB_EVAL_BUDGET_USD`, `HOOP_HUB_EVAL_INPUT_COST_PER_MILLION`, and `HOOP_HUB_EVAL_OUTPUT_COST_PER_MILLION` for each paid run using the configured model's current prices.

```bash
bun run eval:model -- --repetitions 1
bun run eval:live -- --repetitions 1
```

- Required credentials and NBA connectivity are available.
- Live failures are classified as product regressions, model instability, upstream availability, or environment configuration.
- A focused case is repeated when the change addresses stochastic behavior.
- Live eval reports are retained as CI artifacts and contain no secrets.
- Set optional cached-input/cache-write prices when the provider reports these token categories. Failed calls without usage retain their conservative reservation and do not constitute an exact billed-cost measurement.

Live checks remain separate from deterministic PR CI because OpenAI and NBA availability are external dependencies.

## Required browser gates for presentation or clip releases

- Ask at least one stat, trend, comparison, and clip question through the real UI.
- Confirm tables and charts match the grounded answer population.
- Confirm video URLs load, next/previous works, `Play all` advances after user activation, and unavailable clips fail clearly.
- Confirm empty and partial results are honest and do not broaden the request.
- Confirm mobile and desktop layouts remain usable.
- Confirm current activity and verified artifacts appear while narration loads; cancellation and stream failure preserve clearly labeled partial evidence.
- Reopen saved research after a server restart and exercise a generated follow-up without losing its filters.
- Compile a saved real NBA playlist, verify the MP4 with ffprobe, and inspect omitted-media and expired-download behavior.
- Check implicit season defaults immediately before and after the published opening tip, and preserve explicitly requested future seasons.

## Release decision

- Do not merge when deterministic grounding fails.
- Do not claim live readiness when live checks were skipped or blocked; record the blocker.
- Do not treat browser autoplay restrictions as missing media, but verify the user-facing fallback.
- Record any newly discovered regression as an automated test or eval before release.

## Invite beta deployment gate

The portable package and operator commands are documented in [BETA_DEPLOYMENT.md](BETA_DEPLOYMENT.md). Host selection is separate from local implementation readiness.

- `bun run beta:smoke` passes against the actual Node production build with isolated accounts and a loopback model fixture. Verify progress before result, disconnect cancellation, quotas, private history/traces/exports, CSRF/body limits, feedback and restart persistence.
- Build `hoop-hub-beta:local` and run `bun run beta:container-smoke`. Verify the non-root read-only runtime, persistent volumes, invitations, session survival across container recreation and snapshot restore.
- Validate Compose/Caddy configuration and keep direct app traffic private. Configure the exact HTTPS origin, trusted proxy address and server-only key/model/prices.
- Confirm source display permission before enabling external research; confirm PBP Stats separately. A passing readiness endpoint does not establish these rights or live connectivity.
- Run the real-model/NBA/media/browser checks through the chosen host and proxy before sending invites. Retain the results and classify any upstream failures explicitly.
- Verify an off-host backup destination and a disposable restore. Database snapshots exclude compiled media.
- Start with a small invited pilot; establish latency/cost/coverage measurements before broader sharing or multiple replicas.
