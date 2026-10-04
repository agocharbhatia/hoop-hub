# Basketball University visual reference

Reviewed the public image gallery and three full-size graphics from [@UofBasketball](https://x.com/UofBasketball) on October 4, 2026. These are visual observations, not confirmation of the software or internal pipeline they use. No third-party graphics or signed-in browser screenshots are copied into the repository.

## Observed examples

### Scoring peaks: a table that works as a graphic

[Highest three-year PPG stretches since 1997](https://x.com/UofBasketball/status/2090841482638790661).

- One bold title establishes the population and time period.
- Player portraits and team logos anchor each row; names, years and PPG remain visible.
- Five efficiency columns use signed values and a green/yellow/red cell background, making strengths and weaknesses easier to scan than a plain table.
- Source and eligibility notes occupy the footer rather than competing with the main data.

Useful for Hoop Hub: a heatmap table for verified multi-player comparisons. Keep metric definitions accessible and numeric values visible; color alone must not carry meaning. Their dense twenty-row, abbreviated-column image should not be copied directly into a phone layout.

### Shot zones: efficiency and volume together

[Killian Hayes career zone efficiency](https://x.com/UofBasketball/status/2105686657727172799).

- Portrait, player name and career period sit above the court.
- Court regions are colored relative to the career league average, with an explicit diverging legend.
- Each region shows makes/attempts, FG%, and a smaller league-average value.
- The chart communicates both where performance differs and the sample behind the percentage.

Useful for Hoop Hub: add a zone-summary presentation alongside existing individual-shot and density views. A tap selects a zone and exposes its full sample and matching events. League-relative coloring is allowed only when the comparison population, seasons, shot-zone definitions and weighting are verified. With no comparable baseline, show raw FG% or volume with an appropriate legend instead.

### Team rankings: identity plus one prominent value

[2026–27 win-total projections](https://x.com/UofBasketball/status/2106058295169491254).

- Three ordered columns fit thirty teams into one graphic.
- Each entry has a team logo, one large value and a short team abbreviation.
- Team colors aid recognition; repeated small dot marks encode approximate wins.
- Source date and rounding information appear in a small footer.

Useful for Hoop Hub: compact team/player ranking entries with a logo or portrait, full accessible name, primary value and visible rank. Prefer precise values with a shared comparison scale over the dot decoration, which is redundant and less precise. Use one column on phones and a clearly numbered reading order when wider layouts use multiple columns. Betting projections in this reference are not a new Hoop Hub data source.

## Proposed implementation order

1. **Zone shot summary.** Makes/attempts and FG% directly on the court, readable mobile labels, tap/keyboard selection, optional verified league comparison. Preserve the original event IDs and clip drill-through.
2. **Comparison heatmap.** Portrait/name rows, a few selected metric columns, inline units, explicit color legend and a metric picker. Use neutral coloring for metrics whose favorable direction is unknown; distinguish percentage points from percent change.
3. **Ranking presentation.** Emphasize the requested metric and rank; retain complete names and compact sample context. Preserve the existing lineage/population checks and expandable source details.
4. **Shareable graphic export.** An optional later feature using the same validated view model as the interactive artifact, with readable labels, time period, source and sample context. Export is not implemented by this reference review.

## Product constraints

- Keep Hoop Hub's existing dark theme, typography and blue accent. Borrow visual hierarchy and information encoding, not third-party branding or assets.
- Put the basketball question in the heading. Give the primary value/visual more weight than secondary metadata; omit duplicate raw-data prose already conveyed by the artifact.
- Use the existing canonical player/team imagery. Historical team identity must come from the requested period, never today's roster inferred from a player name.
- Maintain full labels, numeric text, keyboard/touch access and readable contrast. Mobile should change the layout rather than shrink a desktop graphic.
- Keep sources and methodology expandable, but visibly flag incomplete or incompatible data when it affects the answer.
- Do not invent percentiles, league baselines, provider access or analytical claims to imitate a reference graphic.

This commit records the design direction only. No application behavior changed and no application tests were required.
