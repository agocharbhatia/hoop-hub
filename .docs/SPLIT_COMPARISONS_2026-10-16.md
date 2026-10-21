# Split comparisons and question-aware artifact selection

The research interface serves basketball analysts and creators. Each answer leads with the evidence requested by the question. Compact paired cohorts use the existing Geist, dark and blue design; routine metric definitions and the removed delta formula caption stay out of UI and image exports.

## Behavior

`compare_splits` resolves one player or team, fetches complete bounded game logs through the existing NBA endpoint client, and computes an immutable `split_comparison` artifact. Supported cohorts are an explicit before/after cutoff, chronological halves of recorded games, away/home, losses/wins and two complete seasons. The cutoff belongs to the after cohort. An odd game belongs to the first half; actual game counts and dates make the partition explicit. Seasons always display from earlier to later.

Counting metrics support per-game values or totals. Shooting percentages pool exact source counts, including TS%, eFG%, FG%, 3P%, FT% and three-point attempt share. Missing, conflicting, impossible or zero-denominator evidence stays missing or fails closed. Duplicate games cannot inflate the sample. Undefined favorable direction stays neutral; lower turnovers can be favorable even though the signed change is negative.

The visual pairs cohort values with small movement markers, signed change badges, precise units and inline supporting counts. Data, CSV, PNG and board pins derive from the same source cells. CSV retains full precision, both samples/date spans, supporting counts and a separate change unit for percentage-point deltas. Refinements preserve the cutoff independently of overall dates; complete two-season comparisons offer rate changes without misleading date controls.

Artifact composition recognizes table, film, shot map, change, ranking, trend, relationship and comparison requests. The earliest specific analytical task determines the primary visual, preserving distinct supporting evidence and original artifact indices. Generic comparison language does not override an explicit trend or map. Duplicate suppression requires matching source populations and metrics, not coincidentally equal numbers. An explicit table request opens the matching Data view.

## Evidence limits

The split tool does not support last-N windows, clutch/quarter/starter/bench filters, possession-normalized rates or named-opponent filtering. It rejects those requests rather than silently using the whole season. Trade, injury and All-Star cutoffs require an explicit verified date. Cohort differences are descriptive and do not establish a cause. Missing/thin cohorts and stale source snapshots remain visible.

## Validation

- The local prompt-level agent suite passes all 54 runs, including twenty player/team cohort questions and two compound change/trajectory questions. A separate seven-case custom-shot contract suite and all thirty endpoint catalog contracts pass.
- The configured model passed 22 focused questions against actual NBA responses: two phrasings for each of five cohort types for both players and teams, plus two mixed-evidence questions asserting primary artifact order. The live checks verify canonical subject, scope, requested metrics, samples, pooled percentages and displayed values.
- Frozen-model checks initially passed 18 of 20. Both failures concerned a synthetic team season with only twenty games, which correctly prompted incomplete-season warnings. The fixture was corrected to 82 dated games, and both affected questions passed on rerun. Warning checks were preserved.
- Real-browser checks cover saved live answers, exact Data, PNG/CSV downloads, board pinning/notes/reload/brief export, and a real-model totals refinement preserving both seasons. All five cohort layouts fit desktop, 390px and 320px widths without document overflow.
- A regression test covers unavailable game logs suppressing fabricated final numbers; another preserves the independent cutoff during date refinement. No additional dependencies were introduced.

This records focused split/composition acceptance. It does not certify deployment, browser video playback or a whole-product live release. The external review gallery contains application screenshots and downloads from real NBA results; synthetic edge fixtures remain separately labeled in the opt-in `/dev/research` lab.
