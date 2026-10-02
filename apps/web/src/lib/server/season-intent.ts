export type NbaSeasonOpening = { season: string; startsAtUtc: string; sourceUrl: string };

/** Published first-tip times define regular-season defaults; calendar month changes do not. */
export const NBA_REGULAR_SEASON_OPENINGS: readonly NbaSeasonOpening[] = [
	{ season: '2023-24', startsAtUtc: '2023-10-24T23:30:00Z', sourceUrl: 'https://www.nba.com/news/2023-24-nba-regular-season-schedule' },
	{ season: '2024-25', startsAtUtc: '2024-10-22T23:30:00Z', sourceUrl: 'https://www.nba.com/news/2024-25-nba-regular-season-schedule' },
	{ season: '2025-26', startsAtUtc: '2025-10-21T23:30:00Z', sourceUrl: 'https://www.nba.com/news/nba-rosters-set-for-2025-26-regular-season' },
	{ season: '2026-27', startsAtUtc: '2026-10-20T19:00:00Z', sourceUrl: 'https://www.nba.com/news/key-dates' }
];

/** Unknown future openings retain the latest verified season instead of inventing an annual rollover. */
export function resolveLatestStartedNbaSeason(now = new Date(), openings: readonly NbaSeasonOpening[] = NBA_REGULAR_SEASON_OPENINGS): string {
	const timestamp = now.getTime();
	if (!Number.isFinite(timestamp)) throw new Error('NBA season resolution requires a valid reference date.');
	let latest: NbaSeasonOpening | undefined;
	let latestTimestamp = Number.NEGATIVE_INFINITY;
	for (const opening of openings) {
		const startsAt = Date.parse(opening.startsAtUtc);
		if (Number.isFinite(startsAt) && startsAt <= timestamp && startsAt > latestTimestamp) { latest = opening; latestTimestamp = startsAt; }
	}
	if (!latest) throw new Error('No verified NBA regular-season opening is available before this reference date. Specify a season explicitly.');
	return latest.season;
}
