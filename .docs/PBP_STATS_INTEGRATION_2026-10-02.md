# PBP Stats integration — October 2, 2026

The natural-language research agent now answers five additional possession-derived question families using PBP Stats. NBA IDs remain the shared player/team identity. The provider catalog and transport are separate from question interpretation and server-owned calculations, so further providers can be added without mixing their cache keys or response formats into the NBA endpoint client.

## Working questions

- “Compare Toronto Raptors offensive, defensive and net ratings with Scottie Barnes on and off the court in the 2025-26 regular season, with a chart.”
- “Compare Toronto’s offensive and defensive four factors with Scottie Barnes on and off court in 2025-26.”
- “Compare all on/off combinations of Scottie Barnes and Immanuel Quickley for Toronto in the 2025-26 regular season.”
- “Rank Toronto Raptors top 5 lineups by net rating in the 2025-26 regular season, with at least 100 offensive and defensive possessions.”
- “Show Toronto Raptors offensive efficiency by possession start in the 2025-26 regular season.”

Lineup rankings also support lowest defensive rating, highest offensive rating, minimum minutes, included players and date ranges. Combination queries accept one to three players and optionally restrict to games where all appeared. Short season comparisons replay validated scopes. Follow-up chips retain player/date/sample filters and alternate offensive/defensive rankings.

Tables support sorting/filtering/pagination; charts support ordering and keyboard/hover inspection. Provider labels identify the source and limited populations. Real source retrieval emits progress and verified artifacts through the existing SSE flow. Results and scopes persist in saved research.

## Grounding and limits

- Ratings use each side’s own possession denominator. Net rating and on-minus-off differences are computed by the server. Four-factor fractions are converted to percentages; free-throw rate is labeled FTA per 100 FGA.
- Full returned lineup rows are filtered and sorted before limiting the displayed top results. Qualification requires the requested minimum on both offensive and defensive possessions. Actual seconds supply minute samples where the feed omits rounded minutes.
- Equivalent on/off metric calls share one canonical population rather than duplicating artifacts. One on/off call already supplies all three ratings.
- The live Raptors lineup feed returned 500 rows, ten of which met the 100-possession floor. Five are displayed. The provider may cap that population; the app never claims a verified complete league/team ranking from it.
- On/off evidence is descriptive and cannot isolate causal player impact or establish the defender on a shot. Possession-start categories overlap and have no sample counts in this feed.
- Unsupported opponent, quarter, clutch, home/away, last-N-game and tactical/primary-defender constraints are rejected rather than silently dropped. No new tagged video or named-defender clip join is provided by these aggregate endpoints.

## Configuration and operations

`HOOP_HUB_ENABLE_LIVE_PBPSTATS` defaults to enabled. The client uses a six-hour persistent cache with provider/dataset/parser/parameter keys, a 20-second retrieval deadline, at most two concurrent requests, a bounded queue, cancellation and an 8 MiB response limit. Expired snapshots can be returned explicitly stale on transport failure. Default unit tests and frozen evaluations disable external provider networks.

Internal use is the default. With `HOOP_HUB_DATA_USE=public`, PBP Stats is unavailable unless the operator enables `HOOP_HUB_PBPSTATS_PUBLIC_DISPLAY_ALLOWED=1` after obtaining applicable rights. Hosted API reuse terms and SLA remain unconfirmed; public documentation and parser licensing do not establish hosted-data display rights. No subscription was bought or provider contacted. See [provider research](ADVANCED_ANALYTICS_SOURCES_2026-10-02.md) for paid options.

## Verification and measured usage

- 519 unit tests, 28 local evaluation runs, seven custom-shot contracts and 30 NBA endpoint contracts passed. Type checking returned zero errors/warnings; the production build and relocated Node transport check passed.
- Two real-model questions against strictly scoped synthetic fixtures passed. Both real-provider questions passed after live failures exposed duplicate on/off populations and sparse lineup minutes; each issue now has a regression test.
- Direct production-parser checks passed for all five modes against real provider responses. The successful on/off and lineup live questions took 14.95 and 23.16 seconds, with estimated model costs of $0.001994 and $0.003799. These runs benefited from provider caching.
- A generated defensive-lineup follow-up completed through the UI in 10.79 seconds, preserved the season and sample floor, and saved successfully after the server had restarted. Browser QA also checked sorting, chart interaction, responsive layout and the provider label.
- All model probes in this iteration, including initial failed live evaluations and the UI follow-up, estimated **$0.019835** at the configured rate assumptions. This is a token-based estimate, not a billing receipt or a general latency/cost guarantee.

Redacted run details and rate assumptions are in [the evidence file](evidence/possession-provider-2026-10-02.json). Run the provider cases with `bun run eval -- --tag pbpstats`, or use `eval:model`/`eval:live` with explicit model budget and price environment variables.

The next paid integration should be selected by missing question coverage: skill/role/impact metrics need a licensed advanced-metric feed; tagged defensive possessions need an event provider. Broader box scores alone will not unlock those questions.
