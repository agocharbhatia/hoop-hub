# Advanced analytics sources for Hoop Hub

Researched 2026-10-02 using provider documentation, pricing pages and terms. Prices are displayed dollar amounts; BALLDONTLIE explicitly labels its prices USD. Taxes, regional billing and negotiated licenses are not included. No subscriptions, accounts or provider outreach were initiated.

## Recommended path

Expand possession and lineup research first, then evaluate one specialist source against questions Hoop Hub cannot currently answer. A dashboard membership is useful for exploring metrics, but does not establish programmatic access or permission to expose those metrics in a public app.

- **Lowest cash cost:** prototype PBP Stats possession/on-off support, or use its parser over NBA play-by-play we already retrieve. Confirm hosted API/data reuse terms before a public rollout.
- **Broad skill and role coverage:** investigate a BBall Index API or licensed export agreement. Its breadth makes it a strong candidate, but integration access is unconfirmed.
- **Impact and estimated skill metrics:** Dunks & Threes has a documented API and published price. Its standard plan fits private/internal research; a public app needs permission.
- **Tactical search and defender attribution:** evaluate a Synergy sample/trial. Measure tag completeness and NBA event joins before buying. Video access remains a separate unresolved requirement.
- **Inexpensive paid transport alternative:** compare BALLDONTLIE against our existing NBA coverage and latency. It is easier to budget, but much of its value overlaps NBA-derived statistics. Do not assume a paid feed improves latency or correctness without a benchmark.

## Provider comparison

| Source | Verified access and price | Useful additional coverage | Decision |
| --- | --- | --- | --- |
| BBall Index | Consumer tools $5/month or $52.50/year at current sale price. No public developer API verified. | Advertises 700+ metrics across 28 categories, including skills, roles, matchup context and LEBRON. | Best breadth candidate. Ask about licensed API/batch exports, fields, update cadence and public-app rights. Consumer price is not an integration quote. [Products](https://www.bball-index.com/), [membership](https://www.bball-index.com/become-a-member/), [terms](https://www.bball-index.com/legal/terms-and-conditions/). |
| Dunks & Threes | Premium + API $250/year, billed annually; approximately $20.83/month equivalent. | EPM, estimated skills, team ratings and predictions through documented REST endpoints. | Suitable internal experiment if those questions matter; public use requires written permission under its API terms. [Pricing](https://dunksandthrees.com/subscribe), [API](https://dunksandthrees.com/api/v1/documentation), [terms](https://dunksandthrees.com/terms). |
| PBP Stats | Public API docs and open-source parsing package; no paid hosted plan verified. | Possessions, event lineups, shot-zone context, on/off and combinations of players on/off. | First low-cost coverage spike. Hosted API commercial terms/SLA unconfirmed; library licensing is separate from underlying data rights. [API examples](https://github.com/dblackrun/pbpstats-api-code-examples), [API schema](https://api.pbpstats.com/openapi.json), [parser](https://pbpstats.readthedocs.io/en/latest/). |
| Sportradar Synergy | Official REST API; sales entitlement for current data. No public Synergy-specific price verified. | Manually tagged possession/play-type data, shot coordinates, lineups and defensive participant roles. | Strong tactical candidate; buy only after sample coverage and licensing checks. No video endpoint found in the documented v1 schema. [Overview](https://developer.sportradar.com/basketball/reference/synergy-basketball-overview), [schema](https://api-docs.sportradar.us/Synergy/Synergy_Basketball_v1.json). |
| BALLDONTLIE | NBA GOAT $39.99 USD/month, 600 requests/minute. $9.99 All-Star excludes advanced stats. | Advanced game/season statistics, tracking/hustle categories, lineups and plays. | Consider a measured transport/coverage trial. Its terms permit commercial/AI uses subject to restrictions, including competing products and resale of unmodified data; underlying third-party rights are not guaranteed. [NBA docs](https://docs.balldontlie.io/), [terms](https://www.balldontlie.io/terms.html). |

## What Synergy could change for the clip engine

The API distinguishes the defender of the possession finisher (`dPlayer`), defender of the pick-and-roll ball handler (`sPlayer`) and defender of the screener (`bPlayer`). The first can be missing; the latter two are NBA-only. These are specific roles, not proof of who guarded every action. [Role definitions](https://developer.sportradar.com/basketball/reference/synergy-basketball-overview), [FAQ](https://developer.sportradar.com/basketball/reference/synergy-basketball-faqs).

The play-by-play schema includes possession/event identifiers, `external.idsEventID`, clocks, lineups and offensive/defensive strings. Exact NBA event correspondence and clock semantics need sample validation. Switching, closeouts and help-defense taxonomy are not sufficiently documented to promise complete coverage. A successful metadata join would improve search; playable video and distribution rights still require separate verification. [Play-by-play endpoint](https://developer.sportradar.com/basketball/reference/get_basketball-league-games-gameid-playbyplays), [schema](https://api-docs.sportradar.us/Synergy/Synergy_Basketball_v1.json).

Data arrives approximately 30 minutes to four hours after games; some games lack reliable play-by-play. Trial data may expose an older season, and most endpoints offer two or three recent seasons. General trial terms permit internal evaluation rather than public display. A portal membership is not an automated-ingestion license. [FAQ](https://developer.sportradar.com/basketball/reference/synergy-basketball-faqs), [API terms](https://developer.sportradar.com/sportradar-updates/page/terms-and-conditions), [portal terms](https://developer.sportradar.com/sportradar-updates/page/synergy-sports-system-and-synergy-sports-portal-terms-of-use).

## Sources to defer

Second Spectrum is an official NBA team analytics provider, but no self-serve optical-tracking API or public price was verified. Its capabilities do not imply developer entitlement. [Provider announcement](https://www.geniussports.com/newsroom/nba-and-genius-sports-second-spectrum-expand-partnership-to-deepen-nba-league-pass-innovations-with-enhanced-basketball-analytics-and-develop-new-next-gen-platform/).

Sports Reference has specific restrictions on competing databases and AI prompt/answer use; custom dataset requests start at $5,000. A Stathead subscription or CSV export does not resolve those restrictions. Defer unless a negotiated dataset is essential. [Data-use policy](https://www.sports-reference.com/data_use.html).

## Connectivity check

One unauthenticated PBP Stats request for Scottie Barnes/Toronto, 2025-26 regular season, returned HTTP 200 in 1.35 seconds. It returned four offensive and four defensive on/off factors plus minutes on/off. This verifies one endpoint's present reachability, not season completeness, numerical correctness, app latency or an SLA. The sample was not added to Hoop Hub's query runtime.

Endpoint: `GET /get-four-factor-on-off/nba` with `Season=2025-26`, `SeasonType=Regular Season`, `TeamId=1610612761`, `PlayerId=1630567`. [Documented interface](https://api.pbpstats.com/docs).

## Implementation design after source selection

The current catalog and runtime are NBA-specific. Add provider adapters and a capability registry rather than passing external URLs through `call_nba_stats_endpoint`.

1. Namespace cached datasets by provider, dataset and schema version; maintain explicit player/team/game ID mappings.
2. Preserve metric definitions, units, population, season, update date and source. EPM and LEBRON remain distinct metrics.
3. Support API retrieval and licensed CSV/batch imports through the same queryable interface. Refresh suitable season datasets in the background to avoid fetching an entire provider dataset per question.
4. Route only to configured capabilities. Keep keys on the server and encode retention, public display and export permissions in provider configuration.
5. Retain partial coverage and missing role counts in tables, charts and clip results. Never turn a missing defender tag into negative evidence.

Evaluate each candidate against a frozen question set: lineup/on-off effects, possession start context, skill/role comparisons, impact trends, and tagged defensive possessions. Report newly answerable questions, field completeness, ID-match rates, source agreement, latency, API consumption and total cost. Buy on measured additional coverage rather than endpoint count.

Before any paid trial, verify its billing commitment and cancellation terms. BALLDONTLIE advertises a 48-hour GOAT trial requiring a payment method, limited to five requests/minute; Dunks & Threes is an annual purchase. Synergy pricing and entitlements require a quote. [BALLDONTLIE trial](https://docs.balldontlie.io/), [Dunks & Threes subscription terms](https://dunksandthrees.com/terms), [Sportradar commercial access](https://sportradar.com/media-tech/data-content/sports-data-api/).
