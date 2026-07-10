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

```bash
bun run eval:live -- --repetitions 1
```

- Required credentials and NBA connectivity are available.
- Live failures are classified as product regressions, model instability, upstream availability, or environment configuration.
- A focused case is repeated when the change addresses stochastic behavior.
- Live eval reports are retained as CI artifacts and contain no secrets.
- Set both eval pricing environment variables when cost is a release gate; otherwise reports intentionally show cost as unavailable.

Live checks remain separate from deterministic PR CI because OpenAI and NBA availability are external dependencies.

## Required browser gates for presentation or clip releases

- Ask at least one stat, trend, comparison, and clip question through the real UI.
- Confirm tables and charts match the grounded answer population.
- Confirm video URLs load, next/previous works, `Play all` advances after user activation, and unavailable clips fail clearly.
- Confirm empty and partial results are honest and do not broaden the request.
- Confirm mobile and desktop layouts remain usable.

## Release decision

- Do not merge when deterministic grounding fails.
- Do not claim live readiness when live checks were skipped or blocked; record the blocker.
- Do not treat browser autoplay restrictions as missing media, but verify the user-facing fallback.
- Record any newly discovered regression as an automated test or eval before release.
