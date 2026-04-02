import type { EndpointFetchRequest } from '$lib/server/data';

export const CURRENT_SEASON_LEAGUE_WIDE_ENDPOINT_IDS = ['leaguedashplayerstats', 'leaguedashteamstats'] as const;
export const DEMO_PLAYER_COHORT_ALLOWLIST_IDS = ['1630173'] as const;

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
	return {
		endpointId: 'leaguedashteamstats',
		params: {
			DateFrom: '',
			DateTo: '',
			GameSegment: '',
			LastNGames: '0',
			Location: '',
			MeasureType: 'Advanced',
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

export function deriveNightlyPlayerComparisonCohort(
	playerStatsPayload: unknown,
	allowlist: readonly string[] = DEMO_PLAYER_COHORT_ALLOWLIST_IDS
): string[] {
	const resultSet = extractLeagueDashPlayerStatsResultSet(playerStatsPayload);
	const playerIdIndex = resultSet.headers.indexOf('PLAYER_ID');
	if (playerIdIndex < 0) {
		throw new Error("League-wide player stats payload is missing the 'PLAYER_ID' column.");
	}

	return [
		...new Set([
			...allowlist,
			...resultSet.rowSet
				.map((row) => String(row[playerIdIndex] ?? '').trim())
				.filter((playerId) => playerId.length > 0)
		])
	].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
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

	return [
		{
			endpointId: 'leaguedashplayerstats',
			request: buildLeagueWidePlayerRankingRequest(season)
		},
		{
			endpointId: 'leaguedashteamstats',
			request: buildLeagueWideTeamDefenseRequest(season)
		}
	];
}
