# Research workspace implementation

Hoop Hub serves analysts and basketball creators. Artifacts carry the detailed evidence; narration gives the useful takeaway. Standard metric definitions and instructional panels stay out of the reading flow.

## Implemented behavior

- **Answer composition:** one primary visual, with separate supporting evidence. Duplicate suppression requires matching source requests and populations; extra metrics and different samples remain visible. Original artifact indices remain stable for pins and exports.
- **Player and team comparisons:** paired metric rows, signed first-minus-second deltas, arrows toward the higher value, favorable colors only for metrics with a defined direction, and compact expandable supporting values. The delta formula caption was removed from UI and images at the user's request.
- **Tables:** question-aware columns, ordering, labels and verified units. Source rows, additional fields, missingness and exact precision remain available.
- **Shooting exploration:** player/team three-point volume versus efficiency, synchronized searchable rankings, up to eight highlights, minimum attempts, totals/per-game volume, qualified group references and efficiency percentiles. Data view uses the same qualified population.
- **Trend context:** original observations, complete trailing five/ten-observation averages and optional window means. Monthly and season series retain their own observation labels. Gaps restart rolling windows.
- **Scope refinement:** season/date/rate controls preserve the requested qualification and other filters. Shooting edits fetch new complete totals through the existing endpoint client and save a new grounded turn. Other supported artifact families compile a standalone replacement scope for the existing query runtime. Failures preserve the prior finding.
- **Exports:** 2400×1600 PNGs, full precision CSVs and Markdown board briefs. Scope, units, source, qualification and saved settings travel with the evidence. CSV strings are protected against formula execution; SVG text is escaped.
- **Research boards:** account-owned boards with server-resolved saved artifact snapshots, chart settings, interpretation notes, standalone notes, ordering, renaming, deletion, exports and links to the original research. Pins survive source-history deletion and expiry.

## Evidence boundaries

The first scatter template covers three-point league player/team populations from Base totals. The server requires exact identities, games, makes and attempts; it rejects sampled sources, conflicting duplicate identities and rounded per-game denominators. It retains the complete candidate population before public row caps and attempt qualification, while preserving every other filter. Missing denominators are excluded explicitly.

The horizontal reference is the combined makes/attempts percentage of qualified subjects. The vertical reference is their arithmetic mean volume. Efficiency percentiles use midranks, including ties, within the same qualified population. Highlights and search do not change these calculations.

Board storage is bounded to 30 boards/account, 40 findings/board, 1 MiB/snapshot and 16 MiB/account. SQLite transactions protect ownership, order and capacity checks. Existing authentication, CSRF, body limits and research admission apply to the new API routes. No new package dependencies were added.

## Verification

From `apps/web`, frozen dependency installation, Svelte/type checks, the full source test suite, 32 deterministic agent evaluations, seven custom-shot evaluations, all 30 endpoint catalog contracts and the production build pass. The focused cases cover full-population calculations, qualification, ties, duplicate identity rejection, composition, export escaping/units, board persistence/ownership, refinements and the totals-repair agent path.

Real-browser QA exercised player/team highlights, thresholds, totals/per-game switching, matching Data views, rolling averages, references, PNG/CSV downloads, board pinning, notes, ordering, brief downloads and reload persistence. Season/date refinements, clearing dates, unavailable scope recovery and board-to-research navigation passed through actual UI/API routes. Responsive checks covered desktop, tablet and widths down to 320px without page overflow.

These checks use deterministic synthetic data. Real-model interpretation, live NBA data and browser video playback remain separate release gates; this implementation does not claim those were exercised.

The subsequent split/composition expansion and its focused real-model/live-NBA validation are recorded in [Split comparisons](SPLIT_COMPARISONS_2026-10-16.md).

## Local visual review

`/dev/charts` has synthetic comparison/table fixtures. The expanded `/dev/research` lab is opt-in and returns 404 unless local auth mode, `HOOP_HUB_UI_FIXTURES=1` and an explicit disposable `HOOP_HUB_DB_PATH` are set. It seeds only that configured database, uses normal persisted evidence and cached source payloads, and labels every example synthetic. Keep this flag off for normal workspaces.
