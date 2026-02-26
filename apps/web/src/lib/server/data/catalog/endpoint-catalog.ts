export type SupportedQueryIntent = 'league_leaders' | 'player_trend' | 'player_compare' | 'team_ranking';

export type EndpointVolatilityTier = 'high' | 'medium' | 'low';

export type EndpointCatalogEntry = {
	endpointId: string;
	path: string;
	requiredParams: string[];
	optionalParams: string[];
	volatilityTier: EndpointVolatilityTier;
	ttlMinutes: number;
	parserVersion: string;
	supportedIntents: SupportedQueryIntent[];
};

const TTL_MINUTES_BY_TIER: Record<EndpointVolatilityTier, number> = {
	high: 15,
	medium: 180,
	low: 1440
};

// Contract fields in ENDPOINT_CATALOG are verified against the swar/nba_api endpoint docs.
const ENDPOINT_CATALOG: EndpointCatalogEntry[] = [
	{
		endpointId: 'leagueleaders',
		path: '/stats/leagueleaders',
		requiredParams: ['LeagueID', 'PerMode', 'Scope', 'Season', 'SeasonType', 'StatCategory'],
		optionalParams: ['ActiveFlag'],
		volatilityTier: 'high',
		ttlMinutes: TTL_MINUTES_BY_TIER.high,
		parserVersion: 'v1',
		supportedIntents: ['league_leaders']
	},
	{
		endpointId: 'playerprofilev2',
		path: '/stats/playerprofilev2',
		requiredParams: ['PerMode', 'PlayerID'],
		optionalParams: ['LeagueID'],
		volatilityTier: 'low',
		ttlMinutes: TTL_MINUTES_BY_TIER.low,
		parserVersion: 'v1',
		supportedIntents: ['league_leaders']
	},
	{
		endpointId: 'playergamelog',
		path: '/stats/playergamelog',
		requiredParams: ['PlayerID', 'Season', 'SeasonType'],
		optionalParams: ['DateFrom', 'DateTo', 'LeagueID'],
		volatilityTier: 'high',
		ttlMinutes: TTL_MINUTES_BY_TIER.high,
		parserVersion: 'v1',
		supportedIntents: ['player_trend', 'league_leaders']
	},
	{
		endpointId: 'boxscoretraditionalv2',
		path: '/stats/boxscoretraditionalv2',
		requiredParams: ['EndPeriod', 'EndRange', 'GameID', 'RangeType', 'StartPeriod', 'StartRange'],
		optionalParams: [],
		volatilityTier: 'medium',
		ttlMinutes: TTL_MINUTES_BY_TIER.medium,
		parserVersion: 'v1',
		supportedIntents: ['player_trend']
	},
	{
		endpointId: 'playercareerstats',
		path: '/stats/playercareerstats',
		requiredParams: ['PerMode', 'PlayerID'],
		optionalParams: ['LeagueID'],
		volatilityTier: 'low',
		ttlMinutes: TTL_MINUTES_BY_TIER.low,
		parserVersion: 'v1',
		supportedIntents: ['player_compare']
	},
	{
		endpointId: 'leaguedashplayerstats',
		path: '/stats/leaguedashplayerstats',
		requiredParams: [
			'DateFrom',
			'DateTo',
			'GameScope',
			'GameSegment',
			'LastNGames',
			'Location',
			'MeasureType',
			'Month',
			'OpponentTeamID',
			'Outcome',
			'PaceAdjust',
			'PerMode',
			'Period',
			'PlayerExperience',
			'PlayerPosition',
			'PlusMinus',
			'Rank',
			'Season',
			'SeasonSegment',
			'SeasonType',
			'StarterBench',
			'VsConference',
			'VsDivision'
		],
		optionalParams: [
			'College',
			'Conference',
			'Country',
			'Division',
			'DraftPick',
			'DraftYear',
			'Height',
			'LeagueID',
			'PORound',
			'ShotClockRange',
			'TeamID',
			'TwoWay',
			'Weight'
		],
		volatilityTier: 'high',
		ttlMinutes: TTL_MINUTES_BY_TIER.high,
		parserVersion: 'v1',
		supportedIntents: ['player_compare', 'league_leaders']
	},
	{
		endpointId: 'leaguedashteamstats',
		path: '/stats/leaguedashteamstats',
		requiredParams: [
			'DateFrom',
			'DateTo',
			'GameSegment',
			'LastNGames',
			'Location',
			'MeasureType',
			'Month',
			'OpponentTeamID',
			'Outcome',
			'PaceAdjust',
			'PerMode',
			'Period',
			'PlusMinus',
			'Rank',
			'Season',
			'SeasonSegment',
			'SeasonType',
			'VsConference',
			'VsDivision'
		],
		optionalParams: [
			'Conference',
			'Division',
			'GameScope',
			'LeagueID',
			'PORound',
			'PlayerExperience',
			'PlayerPosition',
			'ShotClockRange',
			'StarterBench',
			'TeamID',
			'TwoWay'
		],
		volatilityTier: 'high',
		ttlMinutes: TTL_MINUTES_BY_TIER.high,
		parserVersion: 'v1',
		supportedIntents: ['team_ranking']
	},
	{
		endpointId: 'teamdashboardbygeneralsplits',
		path: '/stats/teamdashboardbygeneralsplits',
		requiredParams: [
			'DateFrom',
			'DateTo',
			'GameSegment',
			'LastNGames',
			'Location',
			'MeasureType',
			'Month',
			'OpponentTeamID',
			'Outcome',
			'PaceAdjust',
			'PerMode',
			'Period',
			'PlusMinus',
			'Rank',
			'Season',
			'SeasonSegment',
			'SeasonType',
			'TeamID',
			'VsConference',
			'VsDivision'
		],
		optionalParams: ['LeagueID', 'PORound', 'ShotClockRange'],
		volatilityTier: 'medium',
		ttlMinutes: TTL_MINUTES_BY_TIER.medium,
		parserVersion: 'v1',
		supportedIntents: ['team_ranking']
	}
];

const ENDPOINT_BY_ID = new Map(ENDPOINT_CATALOG.map((entry) => [entry.endpointId, entry]));

export function listEndpointCatalog(): EndpointCatalogEntry[] {
	return ENDPOINT_CATALOG;
}

export function getEndpointCatalogEntry(endpointId: string): EndpointCatalogEntry | undefined {
	return ENDPOINT_BY_ID.get(endpointId);
}

export function resolveDefaultTtlMinutesForTier(tier: EndpointVolatilityTier): number {
	return TTL_MINUTES_BY_TIER[tier];
}
