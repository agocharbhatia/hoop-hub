export type SupportedQueryIntent =
	| 'league_leaders'
	| 'player_trend'
	| 'player_compare'
	| 'team_lookup'
	| 'team_ranking'
	| 'team_standings'
	| 'team_game'
	| 'dynamic';

export type EndpointVolatilityTier = 'high' | 'medium' | 'low';

export type EndpointCatalogEntry = {
	endpointId: string;
	path: string;
	requiredParams: string[];
	optionalParams: string[];
	defaults: Record<string, string>;
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

/* Helper functions */

function padSeasonYear(year: number): string {
	return String(year + 1).slice(-2);
}

function createBaseLeagueDefaults(season: string): Record<string, string> {
	return {
		DateFrom: '',
		DateTo: '',
		GameSegment: '',
		LastNGames: '0',
		LeagueID: '00',
		Location: '',
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
		SeasonType: 'Regular Season',
		VsConference: '',
		VsDivision: ''
	};
}

function createLeagueDashDefaults(season: string, measureType = 'Base'): Record<string, string> {
	return {
		...createBaseLeagueDefaults(season),
		MeasureType: measureType,
		College: '',
		Conference: '',
		Country: '',
		Division: '',
		DraftPick: '',
		DraftYear: '',
		GameScope: '',
		Height: '',
		PORound: '',
		PlayerExperience: '',
		PlayerPosition: '',
		ShotClockRange: '',
		StarterBench: '',
		TeamID: '',
		TwoWay: '',
		Weight: ''
	};
}

function createPlayerDashboardDefaults(season: string): Record<string, string> {
	return {
		...createBaseLeagueDefaults(season),
		MeasureType: 'Base',
		LeagueID: '00',
		PORound: '',
		ShotClockRange: ''
	};
}

function createPtShotLeagueDefaults(season: string): Record<string, string> {
	return {
		CloseDefDistRange: '',
		College: '',
		Conference: '',
		Country: '',
		DateFrom: '',
		DateTo: '',
		Division: '',
		DraftPick: '',
		DraftYear: '',
		DribbleRange: '',
		GameSegment: '',
		GeneralRange: '',
		Height: '',
		LastNGames: '0',
		LeagueID: '00',
		Location: '',
		Month: '0',
		OpponentTeamID: '0',
		Outcome: '',
		PORound: '',
		PerMode: 'PerGame',
		Period: '0',
		PlayerExperience: '',
		PlayerPosition: '',
		Season: season,
		SeasonSegment: '',
		SeasonType: 'Regular Season',
		ShotClockRange: '',
		ShotDistRange: '',
		StarterBench: '',
		TeamID: '',
		TouchTimeRange: '',
		VsConference: '',
		VsDivision: '',
		Weight: ''
	};
}

function createGameLogsDefaults(season: string): Record<string, string> {
	return {
		DateFrom: '',
		DateTo: '',
		GameSegment: '',
		LastNGames: '0',
		LeagueID: '00',
		Location: '',
		MeasureType: 'Base',
		Month: '0',
		OppTeamID: '0',
		Outcome: '',
		PORound: '',
		PerMode: 'PerGame',
		Period: '0',
		PlayerID: '',
		Season: season,
		SeasonSegment: '',
		SeasonType: 'Regular Season',
		ShotClockRange: '',
		TeamID: '',
		VsConference: '',
		VsDivision: ''
	};
}

function createBoxScoreRangeDefaults(): Record<string, string> {
	return {
		EndPeriod: '0',
		EndRange: '0',
		RangeType: '0',
		StartPeriod: '0',
		StartRange: '0'
	};
}

function buildEndpointCatalog(now = new Date()): EndpointCatalogEntry[] {
	const currentSeason = resolveCurrentNbaSeason(now);
	const playerDashboardDefaults = createPlayerDashboardDefaults(currentSeason);

	// Contract fields in ENDPOINT_CATALOG are verified against the swar/nba_api endpoint docs.
	return [
		{
			endpointId: 'leagueleaders',
			path: '/stats/leagueleaders',
			requiredParams: ['LeagueID', 'PerMode', 'Scope', 'Season', 'SeasonType', 'StatCategory'],
			optionalParams: ['ActiveFlag'],
			defaults: {
				LeagueID: '00',
				PerMode: 'PerGame',
				Scope: 'S',
				Season: currentSeason,
				SeasonType: 'Regular Season',
				ActiveFlag: ''
			},
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
			defaults: {
				LeagueID: '00',
				PerMode: 'PerGame'
			},
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
			defaults: {
				DateFrom: '',
				DateTo: '',
				LeagueID: '00',
				Season: currentSeason,
				SeasonType: 'Regular Season'
			},
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
			defaults: createBoxScoreRangeDefaults(),
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
			defaults: {
				LeagueID: '00',
				PerMode: 'PerGame'
			},
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
			defaults: createLeagueDashDefaults(currentSeason),
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
			defaults: createLeagueDashDefaults(currentSeason),
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['team_lookup', 'team_ranking']
		},
		{
			endpointId: 'leaguestandingsv3',
			path: '/stats/leaguestandingsv3',
			requiredParams: ['LeagueID', 'Season', 'SeasonType'],
			optionalParams: ['SeasonYear'],
			defaults: {
				LeagueID: '00',
				Season: currentSeason,
				SeasonType: 'Regular Season',
				SeasonYear: ''
			},
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['team_standings']
		},
		{
			endpointId: 'scoreboardv2',
			path: '/stats/scoreboardv2',
			requiredParams: ['DayOffset', 'GameDate', 'LeagueID'],
			optionalParams: [],
			defaults: {
				DayOffset: '0',
				LeagueID: '00'
			},
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['team_game']
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
			defaults: {
				...createPlayerDashboardDefaults(currentSeason),
				TeamID: ''
			},
			volatilityTier: 'medium',
			ttlMinutes: TTL_MINUTES_BY_TIER.medium,
			parserVersion: 'v1',
			supportedIntents: ['team_lookup', 'team_ranking']
		},
		{
			endpointId: 'commonplayerinfo',
			path: '/stats/commonplayerinfo',
			requiredParams: ['PlayerID'],
			optionalParams: ['LeagueID'],
			defaults: { LeagueID: '00' },
			volatilityTier: 'low',
			ttlMinutes: TTL_MINUTES_BY_TIER.low,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'commonteamroster',
			path: '/stats/commonteamroster',
			requiredParams: ['Season', 'TeamID'],
			optionalParams: ['LeagueID'],
			defaults: {
				LeagueID: '00',
				Season: currentSeason
			},
			volatilityTier: 'medium',
			ttlMinutes: TTL_MINUTES_BY_TIER.medium,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'playerdashptshots',
			path: '/stats/playerdashptshots',
			requiredParams: [
				'DateFrom',
				'DateTo',
				'GameSegment',
				'LastNGames',
				'LeagueID',
				'Location',
				'Month',
				'OpponentTeamID',
				'Outcome',
				'PerMode',
				'Period',
				'PlayerID',
				'Season',
				'SeasonSegment',
				'SeasonType',
				'TeamID',
				'VsConference',
				'VsDivision'
			],
			optionalParams: [],
			defaults: {
				...createBaseLeagueDefaults(currentSeason),
				TeamID: '0'
			},
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'playerdashboardbyshootingsplits',
			path: '/stats/playerdashboardbyshootingsplits',
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
				'PlayerID',
				'PlusMinus',
				'Rank',
				'Season',
				'SeasonSegment',
				'SeasonType',
				'VsConference',
				'VsDivision'
			],
			optionalParams: ['LeagueID', 'PORound', 'ShotClockRange'],
			defaults: playerDashboardDefaults,
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'playerdashboardbygeneralsplits',
			path: '/stats/playerdashboardbygeneralsplits',
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
				'PlayerID',
				'PlusMinus',
				'Rank',
				'Season',
				'SeasonSegment',
				'SeasonType',
				'VsConference',
				'VsDivision'
			],
			optionalParams: ['LeagueID', 'PORound', 'ShotClockRange'],
			defaults: playerDashboardDefaults,
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'shotchartdetail',
			path: '/stats/shotchartdetail',
			requiredParams: [
				'ContextMeasure',
				'DateFrom',
				'DateTo',
				'GameID',
				'GameSegment',
				'LastNGames',
				'LeagueID',
				'Location',
				'Month',
				'OpponentTeamID',
				'Outcome',
				'Period',
				'PlayerID',
				'PlayerPosition',
				'RookieYear',
				'SeasonSegment',
				'SeasonType',
				'TeamID',
				'VsConference',
				'VsDivision'
			],
			optionalParams: [
				'AheadBehind',
				'ClutchTime',
				'ContextFilter',
				'EndPeriod',
				'EndRange',
				'PointDiff',
				'Position',
				'RangeType',
				'Season',
				'StartPeriod',
				'StartRange'
			],
			defaults: {
				...createBaseLeagueDefaults(currentSeason),
				AheadBehind: '',
				ClutchTime: '',
				ContextFilter: '',
				ContextMeasure: 'FGA',
				EndPeriod: '',
				EndRange: '',
				GameID: '',
				PlayerPosition: '',
				PointDiff: '',
				Position: '',
				RangeType: '',
				RookieYear: '',
				StartPeriod: '',
				StartRange: '',
				TeamID: '0'
			},
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'leaguedashptstats',
			path: '/stats/leaguedashptstats',
			requiredParams: [
				'DateFrom',
				'DateTo',
				'GameScope',
				'LastNGames',
				'Location',
				'Month',
				'OpponentTeamID',
				'Outcome',
				'PerMode',
				'PlayerExperience',
				'PlayerOrTeam',
				'PlayerPosition',
				'PtMeasureType',
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
				'TeamID',
				'Weight'
			],
			defaults: {
				...createLeagueDashDefaults(currentSeason),
				PlayerOrTeam: 'Team',
				PtMeasureType: 'SpeedDistance'
			},
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'leaguedashplayerptshot',
			path: '/stats/leaguedashplayerptshot',
			requiredParams: ['LeagueID', 'PerMode', 'Season', 'SeasonType'],
			optionalParams: [
				'CloseDefDistRange',
				'College',
				'Conference',
				'Country',
				'DateFrom',
				'DateTo',
				'Division',
				'DraftPick',
				'DraftYear',
				'DribbleRange',
				'GameSegment',
				'GeneralRange',
				'Height',
				'LastNGames',
				'Location',
				'Month',
				'OpponentTeamID',
				'Outcome',
				'PORound',
				'Period',
				'PlayerExperience',
				'PlayerPosition',
				'SeasonSegment',
				'ShotClockRange',
				'ShotDistRange',
				'StarterBench',
				'TeamID',
				'TouchTimeRange',
				'VsConference',
				'VsDivision',
				'Weight'
			],
			defaults: createPtShotLeagueDefaults(currentSeason),
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'leaguedashteamptshot',
			path: '/stats/leaguedashteamptshot',
			requiredParams: ['LeagueID', 'PerMode', 'Season', 'SeasonType'],
			optionalParams: [
				'CloseDefDistRange',
				'Conference',
				'DateFrom',
				'DateTo',
				'Division',
				'DribbleRange',
				'GameSegment',
				'GeneralRange',
				'LastNGames',
				'Location',
				'Month',
				'OpponentTeamID',
				'Outcome',
				'PORound',
				'Period',
				'SeasonSegment',
				'ShotClockRange',
				'ShotDistRange',
				'TeamID',
				'TouchTimeRange',
				'VsConference',
				'VsDivision'
			],
			defaults: createPtShotLeagueDefaults(currentSeason),
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'leaguegamefinder',
			path: '/stats/leaguegamefinder',
			requiredParams: ['PlayerOrTeam'],
			optionalParams: [
				'Conference',
				'DateFrom',
				'DateTo',
				'Division',
				'DraftNumber',
				'DraftRound',
				'DraftTeamID',
				'DraftYear',
				'EqAST',
				'EqBLK',
				'EqDD',
				'EqDREB',
				'EqFG3A',
				'EqFG3M',
				'EqFG3_PCT',
				'EqFGA',
				'EqFGM',
				'EqFG_PCT',
				'EqFTA',
				'EqFTM',
				'EqFT_PCT',
				'EqMINUTES',
				'EqOREB',
				'EqPF',
				'EqPTS',
				'EqREB',
				'EqSTL',
				'EqTD',
				'EqTOV',
				'GameID',
				'GtAST',
				'GtBLK',
				'GtDD',
				'GtDREB',
				'GtFG3A',
				'GtFG3M',
				'GtFG3_PCT',
				'GtFGA',
				'GtFGM',
				'GtFG_PCT',
				'GtFTA',
				'GtFTM',
				'GtFT_PCT',
				'GtMINUTES',
				'GtOREB',
				'GtPF',
				'GtPTS',
				'GtREB',
				'GtSTL',
				'GtTD',
				'GtTOV',
				'LeagueID',
				'Location',
				'LtAST',
				'LtBLK',
				'LtDD',
				'LtDREB',
				'LtFG3A',
				'LtFG3M',
				'LtFG3_PCT',
				'LtFGA',
				'LtFGM',
				'LtFG_PCT',
				'LtFTA',
				'LtFTM',
				'LtFT_PCT',
				'LtMINUTES',
				'LtOREB',
				'LtPF',
				'LtPTS',
				'LtREB',
				'LtSTL',
				'LtTD',
				'LtTOV',
				'Outcome',
				'PORound',
				'PlayerID',
				'RookieYear',
				'Season',
				'SeasonSegment',
				'SeasonType',
				'StarterBench',
				'TeamID',
				'VsConference',
				'VsDivision',
				'VsTeamID',
				'YearsExperience'
			],
			defaults: {
				Conference: '',
				DateFrom: '',
				DateTo: '',
				Division: '',
				GameID: '',
				LeagueID: '00',
				Location: '',
				Outcome: '',
				PORound: '',
				PlayerID: '',
				PlayerOrTeam: 'T',
				RookieYear: '',
				Season: currentSeason,
				SeasonSegment: '',
				SeasonType: 'Regular Season',
				StarterBench: '',
				TeamID: '',
				VsConference: '',
				VsDivision: '',
				VsTeamID: '',
				YearsExperience: ''
			},
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'playergamelogs',
			path: '/stats/playergamelogs',
			requiredParams: [],
			optionalParams: [
				'DateFrom',
				'DateTo',
				'GameSegment',
				'LastNGames',
				'LeagueID',
				'Location',
				'MeasureType',
				'Month',
				'OppTeamID',
				'Outcome',
				'PORound',
				'PerMode',
				'Period',
				'PlayerID',
				'Season',
				'SeasonSegment',
				'SeasonType',
				'ShotClockRange',
				'TeamID',
				'VsConference',
				'VsDivision'
			],
			defaults: createGameLogsDefaults(currentSeason),
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'teamgamelogs',
			path: '/stats/teamgamelogs',
			requiredParams: [],
			optionalParams: [
				'DateFrom',
				'DateTo',
				'GameSegment',
				'LastNGames',
				'LeagueID',
				'Location',
				'MeasureType',
				'Month',
				'OppTeamID',
				'Outcome',
				'PORound',
				'PerMode',
				'Period',
				'PlayerID',
				'Season',
				'SeasonSegment',
				'SeasonType',
				'ShotClockRange',
				'TeamID',
				'VsConference',
				'VsDivision'
			],
			defaults: createGameLogsDefaults(currentSeason),
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'boxscoreadvancedv2',
			path: '/stats/boxscoreadvancedv2',
			requiredParams: ['EndPeriod', 'EndRange', 'GameID', 'RangeType', 'StartPeriod', 'StartRange'],
			optionalParams: [],
			defaults: createBoxScoreRangeDefaults(),
			volatilityTier: 'medium',
			ttlMinutes: TTL_MINUTES_BY_TIER.medium,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'playbyplayv2',
			path: '/stats/playbyplayv2',
			requiredParams: ['EndPeriod', 'GameID', 'StartPeriod'],
			optionalParams: [],
			defaults: {
				EndPeriod: '0',
				StartPeriod: '0'
			},
			volatilityTier: 'medium',
			ttlMinutes: TTL_MINUTES_BY_TIER.medium,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'playerawards',
			path: '/stats/playerawards',
			requiredParams: ['PlayerID'],
			optionalParams: [],
			defaults: {},
			volatilityTier: 'low',
			ttlMinutes: TTL_MINUTES_BY_TIER.low,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'franchisehistory',
			path: '/stats/franchisehistory',
			requiredParams: ['LeagueID'],
			optionalParams: [],
			defaults: {
				LeagueID: '00'
			},
			volatilityTier: 'low',
			ttlMinutes: TTL_MINUTES_BY_TIER.low,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'teamdetails',
			path: '/stats/teamdetails',
			requiredParams: ['TeamID'],
			optionalParams: [],
			defaults: {},
			volatilityTier: 'low',
			ttlMinutes: TTL_MINUTES_BY_TIER.low,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'teaminfocommon',
			path: '/stats/teaminfocommon',
			requiredParams: ['LeagueID', 'TeamID'],
			optionalParams: ['Season', 'SeasonType'],
			defaults: {
				LeagueID: '00',
				Season: currentSeason,
				SeasonType: 'Regular Season'
			},
			volatilityTier: 'medium',
			ttlMinutes: TTL_MINUTES_BY_TIER.medium,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		},
		{
			endpointId: 'videodetailsasset',
			path: '/stats/videodetailsasset',
			requiredParams: [
				'ContextMeasure',
				'DateFrom',
				'DateTo',
				'EndPeriod',
				'EndRange',
				'GameID',
				'LastNGames',
				'LeagueID',
				'Location',
				'Month',
				'OpponentTeamID',
				'Outcome',
				'Period',
				'PlayerID',
				'RangeType',
				'Season',
				'SeasonSegment',
				'SeasonType',
				'StartPeriod',
				'StartRange',
				'TeamID',
				'VsConference',
				'VsDivision'
			],
			optionalParams: [
				'AheadBehind',
				'ClutchTime',
				'ContextFilter',
				'GameSegment',
				'PointDiff',
				'Position',
				'RookieYear'
			],
			defaults: {
				ContextMeasure: 'FGM',
				DateFrom: '',
				DateTo: '',
				EndPeriod: '10',
				EndRange: '28800',
				GameID: '',
				LastNGames: '0',
				LeagueID: '00',
				Location: '',
				Month: '0',
				OpponentTeamID: '0',
				Outcome: '',
				Period: '0',
				RangeType: '0',
				Season: currentSeason,
				SeasonSegment: '',
				SeasonType: 'Regular Season',
				StartPeriod: '1',
				StartRange: '0',
				TeamID: '0',
				VsConference: '',
				VsDivision: ''
			},
			volatilityTier: 'high',
			ttlMinutes: TTL_MINUTES_BY_TIER.high,
			parserVersion: 'v1',
			supportedIntents: ['dynamic']
		}
	];
}

/* Public catalog API */

export function resolveCurrentNbaSeason(now = new Date()): string {
	const year = now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
	return `${year}-${padSeasonYear(year)}`;
}

export function listEndpointCatalog(): EndpointCatalogEntry[] {
	return buildEndpointCatalog();
}

export function getEndpointCatalogEntry(endpointId: string): EndpointCatalogEntry | undefined {
	return buildEndpointCatalog().find((entry) => entry.endpointId === endpointId);
}

export function resolveDefaultTtlMinutesForTier(tier: EndpointVolatilityTier): number {
	return TTL_MINUTES_BY_TIER[tier];
}
