import type { EndpointFetchRequest } from '$lib/server/data';

export const CURRENT_SEASON_LEAGUE_WIDE_ENDPOINT_IDS = ['leaguedashplayerstats', 'leaguedashteamstats'] as const;

export type CurrentSeasonLeagueWideRequestPlan = {
	endpointId: (typeof CURRENT_SEASON_LEAGUE_WIDE_ENDPOINT_IDS)[number];
	request: EndpointFetchRequest;
};

/* Helper functions */

function padSeasonYear(year: number): string {
	return String(year + 1).slice(-2);
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
