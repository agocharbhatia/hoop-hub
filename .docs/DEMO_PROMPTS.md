# Demo prompts

These requests have implemented data paths. Live answers still depend on source availability and season coverage. Explicit seasons make demos repeatable. “This season” resolves to the latest started NBA season rather than an upcoming season.

## Core research

- Show Scottie Barnes' pull-up mid-range FG% against Boston in the 2024-25 regular season, plot the attempts, and play the available makes.
- Show available clips of Kawhi Leonard's pull-up three-point makes in the 2025-26 regular season.
- Show Scottie Barnes' 2024-25 regular-season shot chart and shooting heatmap.
- Compare Nikola Jokic's rebound trend with Victor Wembanyama's block trend over their last ten games in the 2024-25 regular season. Show charts and compare the earlier five with the latest five for each player.
- What did Jayson Tatum shoot when guarded by Scottie Barnes in the 2024-25 regular season? Include matchup attempts and FG%.
- Show Nikola Jokic's points, rebounds and assists per game in the 2024-25 regular season.

After the filtered Barnes shooting answer, try “Show the misses instead” or “Only the fourth quarter.” Follow-ups retain the saved scope. Saved research reopens across restarts. Use the playlist's compile action to export an available playlist as MP4.

## Additional analytics when PBP Stats is enabled

The Docker beta template leaves this provider disabled until display permission is confirmed.

- Compare Toronto Raptors offensive, defensive and net ratings with Scottie Barnes on and off the court in the 2025-26 regular season, with a chart.
- Compare all on/off combinations of Scottie Barnes and Immanuel Quickley for Toronto in the 2025-26 regular season.
- Rank Toronto Raptors top 5 lineups by net rating in the 2025-26 regular season, with at least 100 offensive and defensive possessions.
- Show Toronto Raptors offensive efficiency by possession start in the 2025-26 regular season.

## Unsupported or partial requests

| Prompt | Current limit |
| --- | --- |
| Show clips of every Tatum shot guarded by Scottie Barnes. | Aggregate matchup statistics work; no reliable defender-to-video event join. |
| Find every Boston pick-and-roll switch that conceded a corner three. | Tactical coverage tagging is unavailable. |
| Rank every player by BBall Index LEBRON or Dunks & Threes EPM. | These licensed datasets are not connected. |
| Show Toronto's clutch on/off rating against Boston over its last ten games. | Those filters are unsupported by the integrated PBP Stats paths. |
| Play all 200 matching shots in one playlist. | Playlists cap at 40 clips and disclose unavailable video; full statistical populations can be larger. |
| Show actual stats for a season that has not started. | No future game data. |
| Analyze EuroLeague games or NFL plays. | Current research coverage is NBA. |
