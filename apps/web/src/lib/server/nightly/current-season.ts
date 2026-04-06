import type { EndpointFetchRequest } from '$lib/server/data';

export const CURRENT_SEASON_LEAGUE_WIDE_ENDPOINT_IDS = ['leaguedashplayerstats', 'leaguedashteamstats'] as const;
export const NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS = ['1630173', '201939', '203081', '203999'] as const;
export const DEFAULT_NIGHTLY_ACTIVE_PLAYER_COHORT_SIZE = 75;
export const SUPPORTED_LOOKUP_SOURCE_VARIANTS = [
	{
		endpointId: 'leaguedashplayerstats',
		measureType: 'Base'
	},
	{
		endpointId: 'leaguedashteamstats',
		measureType: 'Base'
	},
	{
		endpointId: 'leaguedashteamstats',
		measureType: 'Advanced'
	},
	{
		endpointId: 'leaguestandingsv3',
		measureType: null
	}
] as const;

export type CurrentSeasonLeagueWideRequestPlan = {
	endpointId: (typeof CURRENT_SEASON_LEAGUE_WIDE_ENDPOINT_IDS)[number];
	request: EndpointFetchRequest;
};

type ResultSet = {
	headers?: unknown;
	rowSet?: unknown;
};

/* Helper functions */

function padSeasonYear(year: number): string {
	return String(year + 1).slice(-2);
}

function extractLeagueDashPlayerStatsResultSet(payload: unknown): { headers: string[]; rowSet: unknown[][] } {
	if (!payload || typeof payload !== 'object') {
		throw new Error('League-wide player stats payload is not an object.');
	}

	const candidate = payload as {
		resultSet?: ResultSet;
		resultSets?: ResultSet[];
	};

	const resultSet =
		(Array.isArray(candidate.resultSets)
			? candidate.resultSets.find((entry) => Array.isArray(entry.headers) && Array.isArray(entry.rowSet))
			: null) ??
		(candidate.resultSet && Array.isArray(candidate.resultSet.headers) && Array.isArray(candidate.resultSet.rowSet)
			? candidate.resultSet
			: null);

	if (!resultSet || !Array.isArray(resultSet.headers) || !Array.isArray(resultSet.rowSet)) {
		throw new Error('League-wide player stats payload does not contain a readable result set.');
	}

	return {
		headers: resultSet.headers.map((value) => String(value)),
		rowSet: resultSet.rowSet as unknown[][]
	};
}

function normalizeSortableNumber(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string') {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return 0;
}

/* Public current-season planning */

export function resolveSeasonForSlateDate(slateDate: string): string {
	const parsed = new Date(`${slateDate}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`Invalid slate date '${slateDate}'. Expected YYYY-MM-DD.`);
	}

	const year = parsed.getUTCMonth() >= 9 ? parsed.getUTCFullYear() : parsed.getUTCFullYear() - 1;
	return `${year}-${padSeasonYear(year)}`;
}

export function buildLeagueWidePlayerRankingRequest(season: string, seasonType = 'Regular Season'): EndpointFetchRequest {
	return {
		endpointId: 'leaguedashplayerstats',
		params: {
			DateFrom: '',
			DateTo: '',
			GameScope: '',
			GameSegment: '',
			LastNGames: '0',
			Location: '',
			MeasureType: 'Base',
			Month: '0',
			OpponentTeamID: '0',
			Outcome: '',
			PaceAdjust: 'N',
			PerMode: 'PerGame',
			Period: '0',
			PlayerExperience: '',
			PlayerPosition: '',
			PlusMinus: 'N',
			Rank: 'N',
			Season: season,
			SeasonSegment: '',
			SeasonType: seasonType,
			StarterBench: '',
			VsConference: '',
			VsDivision: '',
			Conference: '',
			Division: '',
			LeagueID: '',
			PORound: '',
			ShotClockRange: '',
			TeamID: '',
			TwoWay: ''
		}
	};
}

export function buildLeagueWideTeamDefenseRequest(season: string, seasonType = 'Regular Season'): EndpointFetchRequest {
	return buildLeagueWideTeamStatsRequest(season, 'Advanced', seasonType);
}

export function buildLeagueWideTeamBaseRequest(season: string, seasonType = 'Regular Season'): EndpointFetchRequest {
	return buildLeagueWideTeamStatsRequest(season, 'Base', seasonType);
}

export function buildLeagueWideTeamStatsRequest(
	season: string,
	measureType: 'Base' | 'Advanced',
	seasonType = 'Regular Season'
): EndpointFetchRequest {
	return {
		endpointId: 'leaguedashteamstats',
		params: {
			DateFrom: '',
			DateTo: '',
			GameSegment: '',
			LastNGames: '0',
			Location: '',
			MeasureType: measureType,
			Month: '0',
			OpponentTeamID: '0',
			Outcome: '',
			PaceAdjust: 'N',
			PerMode: 'PerGame',
			Period: '0',
			PlusMinus: 'N',
			Rank: 'N',
			Season: season,
			SeasonSegment: '',
			SeasonType: seasonType,
			VsConference: '',
			VsDivision: '',
			Conference: '',
			Division: '',
			GameScope: '',
			LeagueID: '',
			PORound: '',
			PlayerExperience: '',
			PlayerPosition: '',
			ShotClockRange: '',
			StarterBench: '',
			TeamID: '',
			TwoWay: ''
		}
	};
}

export function buildLeagueStandingsRequest(season: string, seasonType = 'Regular Season'): EndpointFetchRequest {
	return {
		endpointId: 'leaguestandingsv3',
		params: {
			LeagueID: '00',
			Season: season,
			SeasonType: seasonType,
			SeasonYear: ''
		}
	};
}

export function buildSupportedSeasonLookupRequests(season: string, seasonType = 'Regular Season'): EndpointFetchRequest[] {
	return SUPPORTED_LOOKUP_SOURCE_VARIANTS.map((variant) =>
		variant.endpointId === 'leaguedashplayerstats'
			? buildLeagueWidePlayerRankingRequest(season, seasonType)
			: variant.endpointId === 'leaguestandingsv3'
				? buildLeagueStandingsRequest(season, seasonType)
				: buildLeagueWideTeamStatsRequest(season, variant.measureType, seasonType)
	);
}

export function deriveNightlyPlayerComparisonCohort(
	playerStatsPayload: unknown,
	allowlist: readonly string[] = NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS,
	activePlayerLimit = DEFAULT_NIGHTLY_ACTIVE_PLAYER_COHORT_SIZE
): string[] {
	const resultSet = extractLeagueDashPlayerStatsResultSet(playerStatsPayload);
	const playerIdIndex = resultSet.headers.indexOf('PLAYER_ID');
	if (playerIdIndex < 0) {
		throw new Error("League-wide player stats payload is missing the 'PLAYER_ID' column.");
	}

	const minutesIndex = resultSet.headers.indexOf('MIN');
	const activePlayerIds =
		activePlayerLimit <= 0
			? []
			: resultSet.rowSet
					.map((row) => ({
						playerId: String(row[playerIdIndex] ?? '').trim(),
						minutes: minutesIndex >= 0 ? normalizeSortableNumber(row[minutesIndex]) : 0
					}))
					.filter((row) => row.playerId.length > 0)
					.sort((left, right) => right.minutes - left.minutes || left.playerId.localeCompare(right.playerId, undefined, { numeric: true }))
					.slice(0, activePlayerLimit)
					.map((row) => row.playerId);

	return [
		...new Set([
			...allowlist,
			...activePlayerIds
		])
	].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export function prioritizeNightlyPlayerBootstrapOrder(
	playerIds: readonly string[],
	allowlist: readonly string[] = NIGHTLY_PLAYER_COHORT_ALLOWLIST_IDS
): string[] {
	const playerIdSet = new Set(playerIds);
	const prioritizedPlayerIds = allowlist.filter((playerId) => playerIdSet.has(playerId));
	const remainingPlayerIds = playerIds.filter((playerId) => !allowlist.includes(playerId));
	return [...prioritizedPlayerIds, ...remainingPlayerIds];
}

export function buildPlayerComparisonBootstrapRequests(playerIds: readonly string[]): EndpointFetchRequest[] {
	return playerIds.map((playerId) => ({
		endpointId: 'playercareerstats',
		params: {
			PerMode: 'PerGame',
			PlayerID: playerId,
			LeagueID: ''
		}
	}));
}

export function buildPlayerTrendBootstrapRequests(playerIds: readonly string[], season: string): EndpointFetchRequest[] {
	return playerIds.map((playerId) => ({
		endpointId: 'playergamelog',
		params: {
			PlayerID: playerId,
			Season: season,
			SeasonType: 'Regular Season',
			LeagueID: '',
			DateFrom: '',
			DateTo: ''
		}
	}));
}

export function planCurrentSeasonLeagueWideRequests(slateDate: string): CurrentSeasonLeagueWideRequestPlan[] {
	const season = resolveSeasonForSlateDate(slateDate);

	return buildSupportedSeasonLookupRequests(season).map((request) => ({
		endpointId: request.endpointId as (typeof CURRENT_SEASON_LEAGUE_WIDE_ENDPOINT_IDS)[number],
		request
	}));
}
