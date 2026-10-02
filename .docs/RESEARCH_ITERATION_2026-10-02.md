# Research iteration — October 2, 2026

## Delivered

- Live source activity, elapsed time, completed steps, cancellation and verified artifacts while narration loads. Interrupted evidence stays explicitly partial.
- Bounded parallel tools, per-answer retrieval sharing, exact full-name resolution, and direct finalization for complete single-player computations. Required dates/metrics/identities remain strict; missing optional display labels do not cause another retrieval.
- Published opening-tip evidence for implicit seasons. On October 2, 2026, “this season” means 2025-26; explicit 2026-27 requests remain explicit.
- Grounded follow-up chips, persistent SQLite research/history, responsive desktop artifact pairs and mobile saved-research navigation.
- Separate verified multi-player/multi-metric trend populations, canonical charts/comparison tables and computed prose independent of the prompt saying “trend.” Corrected retrievals replace incomplete equivalent attempts without collapsing different dates, seasons, metrics or requested windows.
- Bounded MP4 compilation from saved canonical NBA game/event identities, with progress, cancellation, omissions, expiry and retry.

## Measured latency

Same two real NBA questions, production preview, cached source data, one sample per question/version:

| Question | First-pass preview | Final iteration | Model calls before → after | First activity | First verified artifact |
| --- | ---: | ---: | ---: | ---: | ---: |
| Barnes pull-up mid-range FG% vs Boston, attempts and available makes, 2024-25 | 16.12s | 6.48s | 6 → 3 | 0.084s | 4.05s |
| Jokic rebounds, latest ten games and earlier/later five, 2024-25 | 11.33s | 3.82s | 5 → 2 | 0.003s | 1.33s |

These samples are approximately 60% and 66% faster. They do not establish median/p95 latency or cold-source performance: model output and prompt caching vary, and NBA retrieval can dominate uncached work. The initial streaming iteration did not improve the Barnes sample (16.55s); its redundant planning rounds motivated the completion optimization. The intermediate samples and token categories are retained in [the evidence record](evidence/research-iteration-2026-10-02.json).

At the earlier pricing probe's assumed rates ($0.10 uncached input, $0.01 cache read, $0.125 cache write and $0.50 output per million tokens), the final pair estimates $0.00108. All eight paired timing probes estimate $0.01355. These are token-based estimates with strong provider-cache effects, excluding other UI/live probes and failed calls without usage; they are not a billing receipt or a general cost guarantee.

## Real-data and browser evidence

- Barnes remains 1/2 (50%) against Boston under the exact 2024-25 pull-up mid-range filters. Desktop pairs the chart and film below a compact full-width summary; 375px mobile has no document overflow. Saved results reopen after restart. The misses follow-up retains player, opponent, season and action/value/zone filters.
- “Show all Kawhi Leonard pull-up three-point makes this season” selected 2025-26 and returned 64 matching makes out of 173 attempts. The playlist explicitly shows its 40-of-64 cap; it does not claim all videos are displayed.
- The real mixed question for Jokic REB and Wembanyama BLK finished in 9.47s, with first activity at 0.082s and evidence at 2.49s. It returns exactly two ten-game series and one comparison table: Jokic 10.8 → 12.4, Wembanyama 3.4 → 3.0, each using that player's own game dates. No stale eight-game series or superseded failure warning remains.
- Independently captured historical `playergamelog` snapshots preserve all 70 Jokic and 46 Wembanyama rows, hashes, timestamps and original freshness flags. [The gold corpus](../apps/web/eval/fixtures/real-nba/README.md) derives expected values directly from raw dates/statistics rather than model prose.
- A real two-clip export compiled in 11.2s into a 30.023s, 810,497-byte H.264/AAC MP4 with no omissions. A separate UI-triggered export completed, and its download still returned a valid 206 byte-range response after restart. Exports make no OpenAI calls.

## Validation and limits

- 500 tests across 70 files pass, 24 local eval prompt runs pass, seven custom-shot contracts pass, 30 endpoint contracts pass, Svelte check has zero errors/warnings, and the production build passes relocated NBA transport startup checks.
- Live checks cover the paired questions, implicit Kawhi season, mixed trends, saved refinement and export. This iteration does not rerun the entire broad paid model/live corpus or establish arbitrary-question reliability.
- Named-defender aggregate statistics remain supported; guarding attribution on individual clips remains unavailable because the retrieved feeds do not provide a reliable event-level defender join. Block/steal actor IDs do not establish guarding on every shot.
- Tactical possession labels such as switched pick-and-roll or drop coverage are rejected before retrieval unless a supported recorded shot action answers a narrower request. No tactical annotation or vision pipeline is claimed.
- Published season openings need annual maintenance. SQLite sessions/export queues are suitable for this local instance; authentication, quotas, backups and distributed worker coordination remain production work.

All prior first-pass work and this iteration are committed in separate feature, runtime, presentation, evaluation and documentation commits. No push, PR or deployment was performed.
