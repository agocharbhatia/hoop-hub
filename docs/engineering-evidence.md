# Engineering evidence

These examples link specific failure modes to executable evidence in the current implementation.

## 1. Canonical results survive fabricated model output

The [historical NBA oracle test](../apps/web/src/lib/server/agent/real-nba-trend-gold.test.ts) uses frozen 2024-25 game logs: 70 Jokic games and 46 Wembanyama games. Snapshot hashes, subject identity, request parameters, and capture provenance are checked before using them.

An independent oracle sorts raw game dates, selects each player's own latest ten games, and computes earlier-five/later-five averages directly from the columns. The scripted model deliberately returns an incorrect player, mixed chart, and `999` values. The real agent must return the independently calculated rebound/block series, separate metric charts, correct dates and comparison rows, and no invented `999` prose.

The [fixture provenance](../apps/web/eval/fixtures/real-nba/README.md) records the historical scope and capture details. This verifies computation and reconciliation against captured NBA rows.

## 2. Rankings consider rows outside the model's sample

The [ranking regression](../apps/web/src/lib/server/agent/ordered-ranking.test.ts) builds 300 qualifying rows, places the actual top five at indices 280–284, and appends a nominal leader with only one game. A sampled-row ranking would miss the winners; ranking before qualification would admit the outlier.

The test requires the actual five qualified leaders, the correct full-population aggregate, and matching canonical table/bar values despite wrong model artifacts. Additional cases compare bounded selection with an independent full sort over 750 rows, in both directions and at several output limits. Ties, numeric strings, and nulls are covered explicitly.

## 3. Statistical samples survive missing video

[Custom shot selection](../apps/web/src/lib/server/agent/custom-shot-clips.ts) filters shot events before joining media on exact game/event IDs. [Research regressions](../apps/web/src/lib/server/agent/clip-research.test.ts) verify that made-only playlists keep all matching attempts as the shooting denominator, that media failures preserve valid statistical research, and that follow-ups retain the validated scope.

[Population tests](../apps/web/src/lib/server/agent/shot-populations.test.ts) additionally cover different date windows, empty populations, chart caps, identity containment, and reversed model artifacts. [Named-defender tests](../apps/web/src/lib/server/agent/named-defender-clips.test.ts) reject event attribution that the source does not establish instead of replacing the defender with their team.

Run the dedicated offline video contracts with:

```bash
bun run eval:custom-shots
```

Actual footage delivery, browser autoplay, and playlist auto-advance still require browser acceptance against the intended host.

## 4. Repeated tools share source work without sharing user cancellation

The [run-scoped fetcher](../apps/web/src/lib/server/agent/query-runtime.ts) normalizes request identity and reuses the same in-flight or completed successful request within an answer. It removes failures so a later repair can retry. Separate answers retain separate cancellation scopes.

[Runtime tests](../apps/web/src/lib/server/agent/query-runtime.test.ts) verify that equivalent concurrent and subsequent requests make one upstream call, failed requests can retry, abort signals reach the transport, and a waiting injected operation rejects promptly on cancellation. Agent tests also cover parallel progress and the conditions under which verified work can skip another planning turn.

## 5. Recovery has explicit deadlines and integrity checks

The [provider tests](../apps/web/src/lib/server/data/providers/client.test.ts) cover persistent cache identity, stale fallback, one transient retry, permanent/malformed failures, cancellation, and `Retry-After` bounded by the shared deadline. They also verify that public-display permission is checked before returning an internal cached snapshot.

The [nightly tests](../apps/web/src/lib/server/nightly/bootstrap-service.test.ts) exercise staged materialization, stored-work reuse, failed-request recovery, and incomplete results. [Audit tests](../apps/web/src/lib/server/nightly/data-health.test.ts) distinguish stale/provisional warnings from corrupt or incomplete data.

## 6. Private artifacts stay private after the request finishes

[Ownership regressions](../apps/web/src/lib/server/beta/ownership.test.ts) deny foreign session list/read/update/delete/follow-up operations and foreign export status, download, and cancellation, including after compilation. [Board tests](../apps/web/src/lib/server/research/boards.test.ts) cover owner isolation and immutable saved snapshots. [Authentication tests](../apps/web/src/lib/server/beta/auth.test.ts) exercise single-use invitation redemption and session/throttle persistence across database reopen.

[Export tests](../apps/web/src/lib/server/clip-exports/service.test.ts) verify selection from saved verified playlists, queue behavior, missing-media omissions, and restart handling. [Container smoke](../apps/web/scripts/beta-container-smoke.ts) covers private access, restart persistence, and backup/restore in the packaged runtime.

## Evaluation layers

| Layer | Command | What it establishes | External dependencies |
| --- | --- | --- | --- |
| Unit/route regressions and historical oracle | `bun run test` | Scope, arithmetic, reconciliation, ownership, recovery, and API contracts. | None; live sources disabled. |
| Scripted agent evaluations | `bun run eval` | Specified tool decisions work through the real agent service and satisfy numeric/artifact gates. | None; synthetic fixtures. |
| Custom-shot contracts | `bun run eval:custom-shots` | Exact filters, unsupported intents, empty results, and partial video joins. | None. |
| Real model, fixture data | `bun run eval:model -- --repetitions 1` | The configured model chooses and uses tools against strictly scoped synthetic populations. | Model credentials and explicit evaluation budget. |
| Real model, real sources | `bun run eval:live -- --repetitions 1` | Retrieval availability and consistency between evidence and returned results. | Model credentials, budget, source access. |
| Production HTTP smoke | `bun run beta:smoke` | Built server, authentication, streaming, and production transport packaging. | Built output, local model fixture, FFmpeg/FFprobe for media checks. |
| Container smoke | `bun run beta:container-smoke` | Packaged private runtime, durable state, snapshots, and restore. | Docker and the locally built image. |

The three agent-eval modes produce redacted `results.jsonl` and `summary.md` reports under `apps/web/eval-results/<timestamp>-<mode>/`. Reports include case status, tools, model usage, source/cache metadata, warnings, and gate outcomes. Generated reports stay out of Git; the [live workflow](../.github/workflows/live-smoke.yml) uploads its reports as expiring CI artifacts.

Paid evaluations require `HOOP_HUB_EVAL_BUDGET_USD` and the current input/output prices for the selected model. The [budget wrapper](../apps/web/src/lib/server/eval/model-budget.ts) reserves a conservative allowance before each call, paces requests, and bounds token-rate retries. Cost estimates depend on configured rates; these controls apply to paid evaluation runs, not a general production billing ceiling.

```bash
# Focus an offline regression or inspect available filters.
bun run eval -- --case scottie-made-threes-vs-boston
bun run eval -- --help
```

Synthetic model evaluation is not an independent NBA gold answer. Live consistency is not proof of every answer's numerical truth. Browser media acceptance and hosted data access are separate gates. See [development](development.md) for the normal verification commands and [architecture](architecture.md) for deployment limits.

## Local verification snapshot

Verified on **2026-10-28** during repository cleanup:

| Check | Result |
| --- | --- |
| Type/Svelte check | 0 errors, 0 warnings |
| Unit and route regressions | 709 passed across 109 files |
| Scripted agent evaluation | 54 passed |
| Custom-shot contracts | 7 passed |
| Upstream endpoint documentation contracts | 30 endpoints passed |
| Production build | Passed, including relocated Node transports |
| Production HTTP smoke | Passed with a loopback model fixture |

These are local correctness and packaging results. Docker container verification requires a running daemon; it was unavailable for this run. Paid live-model evaluations and production load testing were outside this verification. The screenshot in the README comes from the synthetic UI lab.
