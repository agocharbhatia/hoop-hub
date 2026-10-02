import type { SemanticQueryRequest } from '$lib/contracts/semantic-query';
import type { CustomShotFilters } from './custom-shot-clips';
import type { DefenderMatchupLeaderboardRequest, PlayerMatchupRequest } from './player-matchups';

export type AggregateFilter = {
	column: string;
	op: 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
	value?: string | number;
	values?: Array<string | number>;
};

export type AggregateOperation = {
	op: 'count' | 'sum' | 'avg' | 'min' | 'max';
	column?: string;
};

export type EndpointRequest = { endpointId: string; params: Record<string, string> };

export type AggregateEndpointRowsRequest = EndpointRequest & {
	resultSetName?: string;
	filters?: AggregateFilter[];
	groupBy?: string[];
	selectColumns?: string[];
	rowLimit?: number;
	orderBy?: { column: string; direction: 'asc' | 'desc' };
	aggregations: AggregateOperation[];
};

export type AnalyzeTimeSeriesRequest = EndpointRequest & {
	resultSetName?: string;
	dateColumn: string;
	valueColumn: string;
	labelColumns?: string[];
	lastN: number;
};

export type FindVideoClipsRequest = {
	playerId: string;
	eventType: 'made_field_goal' | 'made_three' | 'assist' | 'block' | 'steal' | 'rebound' | 'turnover' | 'custom_shot';
	season: string;
	seasonType: 'Regular Season' | 'Playoffs' | 'Play In' | 'NBA Cup';
	teamId?: string;
	opponentTeamId?: string;
	gameId?: string;
	dateFrom?: string;
	dateTo?: string;
	customShot?: CustomShotFilters;
};

/** Only validated research requests can be retained; result rows and model prose are deliberately excluded. */
export type GroundedResearchRequest =
	| { toolName: 'execute_semantic_query'; request: SemanticQueryRequest }
	| { toolName: 'call_nba_stats_endpoint'; request: EndpointRequest }
	| { toolName: 'aggregate_endpoint_rows'; request: AggregateEndpointRowsRequest }
	| { toolName: 'analyze_time_series'; request: AnalyzeTimeSeriesRequest }
	| { toolName: 'find_video_clips'; request: FindVideoClipsRequest }
	| { toolName: 'analyze_player_matchup'; request: PlayerMatchupRequest }
	| { toolName: 'rank_defender_matchups'; request: DefenderMatchupLeaderboardRequest };

export type ResolvedResearchPlayer = { id: string; canonicalName: string; teamId: string | null };
