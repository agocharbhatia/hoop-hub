import type { EndpointFetchRequest } from '$lib/server/data';
import {
	buildLeagueWidePlayerRankingRequest,
	buildLeagueWideTeamDefenseRequest,
	buildPlayerTrendBootstrapRequests
} from './current-season';

export const DEMO_HISTORICAL_BACKFILL_SEASON = '2023-24' as const;
export const DEMO_HISTORICAL_BACKFILL_SEASON_TYPE = 'Regular Season' as const;

/* Public historical backfill planning */

export function planHistoricalDemoSeasonBackfillRequests(playerIds: readonly string[]): EndpointFetchRequest[] {
	return [
		buildLeagueWidePlayerRankingRequest(DEMO_HISTORICAL_BACKFILL_SEASON, DEMO_HISTORICAL_BACKFILL_SEASON_TYPE),
		buildLeagueWideTeamDefenseRequest(DEMO_HISTORICAL_BACKFILL_SEASON, DEMO_HISTORICAL_BACKFILL_SEASON_TYPE),
		...buildPlayerTrendBootstrapRequests(playerIds, DEMO_HISTORICAL_BACKFILL_SEASON)
	];
}
