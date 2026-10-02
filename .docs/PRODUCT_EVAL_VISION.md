# Hoop Hub: research workflow and evaluation contract

Assessment date: 2026-09-28. This is a proposed product target and agent handoff, not a claim of live readiness.

## Recommendation

Complete a focused NBA community research beta. Its promise is: **ask a basketball question, inspect the exact supporting population, watch the matching available plays, and refine the result without starting over.**

Initial audience: engaged NBA fans and small creators who repeatedly move between stats pages and film. This audience is a hypothesis to validate with actual users. A general sports chatbot, all-sports historical database, and automated scouting analyst are outside the first release.

The opportunity is workflow quality, evidence, speed, and access. Natural-language sports lookup alone is already served. Lack of open access to Sportradar does not establish demand, and chat assistants can improve or connect to the same data. The reusable asset should be a reliable query/data layer with a good research interface; a future MCP interface is optional, not a prerequisite.

## Current evidence

Inspected README, agents/current-state.md, the query route, agent service, and evaluation cases/runner/fixtures/assertions.

- Existing implementation includes structured stats, full-row aggregation, charts, exact event/video joins, named-player matchup aggregates, and sample-qualified defender rankings.
- The query route passes a single question to the agent. Persisted conversational grounding is absent.
- Named-defender aggregate tracking data cannot currently be joined to individual shot videos. A game against Boston does not establish that a specific Boston player defended a shot.
- Current-state notes identify historical backfill, typed on/off and lineup support, indexed events, and production controls as gaps.
- Fresh verification: `bun ci` succeeded; `bun run eval -- --output /tmp/hoop-hub-research/local-eval` passed 24/24; `bun run eval:custom-shots` passed 7/7.
- These tests use scripted model decisions and synthetic endpoint fixtures. They establish contract behavior, not natural-language competence or real video availability.
- No OpenAI key or NBA proxy is configured in this checkout's execution environment. No live-model evaluation or browser playback verification was performed. No ChatGPT/Claude comparative runs were performed.
- No application code was changed for this assessment. Full release checks were not run.

## Competitive evidence

Reviewed public pages, not authenticated product internals:

- [Sportradar AI Researcher](https://developer.sportradar.com/broadcast/reference/ai-researcher-overview) advertises complex research, live official data, six sports, and UI/API/MCP access. [Maven](https://maven.sportradar.com) currently displays Request Access. Access restrictions may change; openness alone is not a durable advantage.
- [StatMuse](https://www.statmuse.com/nba) provides public NBA question/search results. Include it in baselines for ordinary lookup.
- [Stathead Basketball](https://www.sports-reference.com/stathead/basketball/) lists season, game, streak, span, quarter, versus, event, and shot finders. Include the manual structured workflow in comparison, not only chatbots.
- [PlayDB](https://www.playdb.app/) is a much closer public competitor: its current homepage advertises natural-language NBA/WNBA play search, player/defender/zone/season filtering, video results, and search without an account. The page includes linked example searches and primary-defender labels. These are observed product claims/examples, not independently verified completeness or defender-label accuracy. Public clip search alone is therefore insufficient differentiation. Include PlayDB directly in the benchmark; investigate its attribution provenance before assuming it solves the defender-event gap.

Do not infer that competitors fail the prompts below from their landing pages. All comparative outcomes start as unmeasured.

## Vision prompt corpus

Use completed 2024-25 regular-season data for reproducible initial cases. Freeze the actual source snapshots and independently establish expected results before grading. These are acceptance specifications, not executable cases or verified sports answers.

| ID | User prompt | Required evidence and behavior | Initial role |
| --- | --- | --- | --- |
| C01 | What was Nikola Jokic's assists per game in the 2024-25 regular season? | Correct player/season, games, assists, reproducible average and source. | Simple baseline control |
| C02 | Who were the top five players in total assists in the 2024-25 regular season? | Full league population, total rather than per-game sorting, tie policy, source. | Simple baseline control |
| V01 | Show Scottie Barnes' pull-up mid-range FG% against Boston in the 2024-25 regular season, plot the attempts, and play the available makes. | One identical filter population for numerator, denominator, chart, and event IDs; playlist includes only makes; disclose missing video and cap. | Core beta |
| V02 | Show Stephen Curry's missed fourth-quarter step-back threes in the 2024-25 regular season, with dates and clips. | Preserve miss, period, action, value and season constraints; actual event identity; empty results are valid. | Core beta |
| V03 | For Scottie Barnes' 2024-25 regular-season left-corner threes, give makes and attempts and separate made and missed clips. | Same population across counts and both playlists; no unavailable clip invented; distinguish matched from returned events. | Core beta |
| V04 | Compare Barnes' pull-up mid-range shooting before and from January 1, 2025 in the 2024-25 regular season. Include attempts, percentages, charts and available clips. | Non-overlapping date windows, weighted make/attempt calculation, honest sample sizes; all artifacts match their windows. | Core beta after single-query grounding |
| V05 | Which five players shot the lowest FG% when tracked against Scottie Barnes in 2024-25, minimum 10 attempts and 25 partial possessions? | Entire matchup population filtered before sorting; roles preserved; tracking attribution disclosed; no causal defensive-quality claim. | Core beta |
| V06 | What did Jayson Tatum shoot when guarded by Barnes in the 2024-25 regular season? Show the sample size and the clips of those attempts. | Answer supported aggregate portion; explain lack of event-level defender join; do not substitute all Raptors games. | Required honest partial answer |
| V07 | What was Oklahoma City's record when Shai scored at least 30 in the 2024-25 regular season? List every qualifying game. | Complete game cohort; record reconciles with rows; >=30 threshold; regular season scope. | Core beta |
| V08 | Show Jokic's rebounds in his final ten appearances of the 2024-25 regular season and compare the earlier five with the later five. | Player appearances, chronological order, exact window sizes, calculations and chart agree. | Core beta |
| V09 | Follow V01 with: Now include misses. Then: Only fourth quarters. Then: Compare that with 2023-24. | Persist player, opponent, shot definition and competition; modify only requested filters; display effective query after each turn. | Next capability: grounded refinement |
| V10 | How did Denver perform in 2024-25 games Jokic missed versus games he played? | Team-game universe joined to player participation, DNP handling, record and denominators; no confusion with possession-level on/off. | Later: participation joins |
| V11 | How did Denver perform with Jokic off the floor in the 2024-25 regular season? | Possession/minute-based on/off data and explicit metric; never substitute games he missed. | Later: on/off |
| V12 | Find 2024-25 players whose last-20-game three-point percentage improved most over their first 20 appearances, with at least 50 attempts in each window. | Full cohort, chronological player appearances, disjoint windows, minimum attempts, aggregate makes/attempts and percentage-point change. | Later: league-wide derived query |
| V13 | Show every Curry three over a double-team in 2024-25. | State missing coverage if double-team labels cannot be established; no shot-description inference presented as fact. | Required capability boundary |
| V14 | Show every Barnes make in the 2024-25 regular season, with all clips. | Exact total event count; returned versus unavailable versus capped clips; no claim that a capped playlist is exhaustive. | Required completeness boundary |

For each core family, add at least three paraphrases plus a sibling case changing player, opponent, threshold, or date. Keep a separate holdout set unseen during prompt tuning. Include zero-match, tied-rank, missing-source, stale-snapshot, partially available video, and contradictory-filter variants. A correct refusal counts toward honesty, not supported-answer coverage.

## Evaluation design

The current runner selects fixtures versus live fetching and scripted versus live models together. It then uses the same expectations in both modes. For example, the Barnes case requires exactly 29/73 and the Jokic trend expects fixture averages. Those generated fixture values must not be treated as live ground truth. Relative wording such as "this season" also requires a fixed evaluation date or explicit season.

Introduce four separately reported layers:

1. **Deterministic contracts:** retain existing scripted tests for computation, filtering, reconciliation and failure handling.
2. **Live model, frozen data:** let the actual model choose tools against a versioned source snapshot. Freeze calendar context, validate request parameters in the fixture adapter, and fail on unrecorded data requests. Existing fixtures select primarily by fixture/endpoint, so strengthen this boundary. Establish gold answers with a separate calculation/review path, not the production function being tested.
3. **Live integration:** exercise real retrieval with explicit season/scope. Check freshness, availability, schema and evidence consistency. Validate numbers against an independently computed oracle from the same captured source snapshot, not synthetic constants. Record external outages separately while still counting their effect on user-visible completion.
4. **Browser workflow:** submit through the UI, refine filters, inspect charts/tables, verify source access, and play/advance clips. A valid-looking URL is insufficient.

Outcome grading should accept any correct tool path. Reserve required internal-tool assertions for contract tests; do not penalize a correct product answer because it used a different valid plan.

Every case records: prompt/turns, model/version, date, search/tool settings, source snapshot identifiers and hashes, effective filters, answer and artifacts, expected result or derivation, latency, retries, model usage, estimated cost when configured, and failure category. Never save secrets.

Grade separate dimensions: scope correctness; numerical correctness; population completeness; provenance; artifact/event consistency; usable video; refinement correctness; calibrated partial answer/refusal. A fabricated number, wrong filter population, or wrong-event clip fails the task regardless of prose quality. Report task completion, honest limitation, and error rates separately.

## Fair comparison with chat applications

Run the same frozen prompts in fresh ChatGPT and Claude conversations with browsing enabled where available. Record the visible model label, date and enabled tools. Also measure StatMuse for lookup, PlayDB for clip retrieval, and a manual NBA/Stathead workflow for research. Do not label an API-model test as a test of the consumer application.

Use the same time allowance and information, preserve full outputs, and allow a fixed number of clarifications for every system. Repeat core cases three times; use holdout siblings to check generalization. Record time to a *verified usable result*, not just first answer. A web search performed by this agent is not a ChatGPT/Claude product benchmark.

Hypotheses to test: ordinary lookup is already well served; compound filters require more manual verification; exact stat-to-play consistency and repeated refinement may be faster and more reliable in Hoop Hub. These are hypotheses, not observed competitor failures.

## Bounded execution plan

1. Repair evaluation separation and establish frozen-data gold cases. Run a baseline before expanding features.
2. Make V01-V08 and V14 work as coherent single-query workflows, preserving honest limitations for V06. Prioritize failures by user impact rather than adding endpoints indiscriminately.
3. Implement V09 using persisted typed query state and explicit updates. Avoid relying solely on chat text to preserve scope.
4. Verify data access and video playback in the intended deployment environment. Confirm a workable data/media permission and hosting path before promising a public service; API reachability alone is not a public distribution plan.
5. Release a small beta with quotas, resource limits, useful failure reporting and saved/shareable research results if needed by testers. Do not expand to other sports, downloadable compilations, or tracking inference yet.

Proposed continuation gates, to revisit after measuring a baseline:

- >=90% complete success on core frozen-data model runs and holdouts; zero fabricated numerical or event evidence in the release sample. Report sample counts, not just percentages.
- All capability-boundary cases preserve scope and state limitations; they do not inflate answer coverage.
- Demonstrated browser playback and refinement on representative cases; availability failures remain visible in end-to-end metrics.
- Record warm/cold latency and cost. Provisional targets: p95 <=15 seconds for simple stats and <=30 seconds for compound research, with longer clip fetches clearly surfaced. Adjust based on observed economics and user tolerance, not by silently weakening gates.
- Ask five target users to bring real questions. At least three should complete a recurring task materially faster or with less verification effort, and choose to use it again. This is directional product evidence, not statistical proof.

Pause broad feature development if reliable data access is infeasible, if users primarily want simple lookups, or if the integrated workflow provides no practical advantage over existing tools. A successful narrow beta is a finite deliverable; "answer every sports question" is not.

## Copyable implementation-agent brief

Continue Hoop Hub toward the NBA research beta specified in `.docs/PRODUCT_EVAL_VISION.md`. First read AGENTS.md if present, `agents/current-state.md`, and `.docs/RELEASE_CHECKLIST.md`. Preserve the dynamic agent and existing deterministic computation paths. Begin by separating scripted contract tests, live-model/frozen-data tests, and live integration checks; remove synthetic fixture numbers from live truth assertions without weakening fixed-data checks. Establish an independent gold corpus and baseline, then address the highest-impact failing core workflow one capability at a time. Add sibling/holdout cases and report measured coverage, not only passing scripts. Implement grounded follow-up refinement after single-query stat/chart/clip consistency. Do not substitute team-level clips for named-defender clips or infer unsupported tracking attributes. Verify deployment data access and browser playback before claiming readiness. Keep changes scoped, run the applicable release checks, and leave an evidence-backed progress report with remaining failures and blockers. Stop at a reviewable beta; do not pursue unlimited feature breadth or claim competitive superiority without comparative runs.
