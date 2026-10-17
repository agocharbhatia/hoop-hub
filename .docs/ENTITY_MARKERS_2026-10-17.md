# Player and team image markers

Shooting scatter plots use canonical player headshots and team logos. The existing identity resolver prevents contradictory ID/name pairs from receiving a face. The shared `EntityAvatar` component preserves the established crop, logo containment, lazy loading and initials fallback.

`presentation/entity-markers.ts` places images at the exact data coordinates. A spatial grid prevents overlapping unselected images; selected and inspected subjects take priority. At most 64 images are rendered per plot, with smaller markers on narrow screens. Crowded neighbors retain dots and remain available through hover, keyboard inspection and the synchronized ranking. The image layer never participates in qualification, references, percentiles or CSV values.

PNG exports apply the same marker policy at export dimensions. Browser canvas cannot read the NBA CDN directly because its responses do not provide CORS access. The authenticated `/api/entity-media/[kind]/[id]` route resolves a known canonical identity to one fixed CDN asset. It accepts no arbitrary URLs, rejects redirects/wrong types, bounds each streamed image to 1 MiB and limits upstream work to four concurrent requests. The cache is bounded to 128 entries/8 MiB with one-day expiry and shares in-flight requests. Clients prepare at most four images concurrently within a six-second export budget. Optional media is rasterized to PNG bytes before SVG/canvas export; failures use initials without losing the underlying figure.

## Verification

- Frozen dependency installation: passed without changes.
- Svelte/TypeScript: zero errors and warnings.
- Full source suite: 698 tests passed across 107 files.
- Deterministic agent evaluations: 54 passed. Custom-shot contracts: seven passed. Endpoint catalog: thirty passed.
- Browser checks cover players, teams, highlights, keyboard inspection, actual PNG/CSV downloads and 390px/320px layouts without document overflow.
- Forced CDN failures retain initials and all 21 player points. Forced export-media failures still produce a PNG. Actual portrait/logo PNGs were visually inspected.

The refreshed external gallery uses clearly labeled synthetic example statistics and real canonical decorative media. Separate proposed shot-profile, peer-context and consistency artifacts are design concepts only; they are not part of this implementation. No paid model evaluations or live stats calls were needed for this presentation change.
