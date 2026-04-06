import { readFileSync } from 'node:fs';
import { stableStringify, type EndpointFetchRequest } from '$lib/server/data';

export type DeterministicFixtureEntry = {
	endpointId: string;
	params: Record<string, string>;
	payload: unknown;
};

export type DeterministicLookupFixtureRequirement = {
	endpointId: string;
	params: Record<string, string>;
	metricIds: string[];
	requiredColumns: string[];
};

/* Helper functions */

function loadFixture(relativePath: string): unknown {
	return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as unknown;
}

function normalizeParams(params: Record<string, string>): Record<string, string> {
	return JSON.parse(stableStringify(params)) as Record<string, string>;
}

function buildFixtureKey(request: Pick<EndpointFetchRequest, 'endpointId' | 'params'>): string {
	return `${request.endpointId}:${stableStringify(request.params)}`;
}

export function buildDeterministicPlayerSeasonStatsParams(season: string): Record<string, string> {
	return {
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
		SeasonType: 'Regular Season',
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
	};
}

function buildPlayerTrendParams(playerId: string, season: string): Record<string, string> {
	return {
		PlayerID: playerId,
		Season: season,
		SeasonType: 'Regular Season',
		LeagueID: '',
		DateFrom: '',
		DateTo: ''
	};
}

function buildPlayerCareerParams(playerId: string): Record<string, string> {
	return {
		PerMode: 'PerGame',
		PlayerID: playerId,
		LeagueID: ''
	};
}

function buildTeamSeasonStatsParams(season: string, measureType: 'Base' | 'Advanced'): Record<string, string> {
	return {
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
		SeasonType: 'Regular Season',
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
	};
}

function buildLeagueStandingsParams(season: string): Record<string, string> {
	return {
		LeagueID: '00',
		Season: season,
		SeasonType: 'Regular Season',
		SeasonYear: ''
	};
}

const PLAYER_SEASON_FIXTURE = loadFixture('../semantic/fixtures/leaguedashplayerstats.json');
const TEAM_BASE_FIXTURE = loadFixture('../semantic/fixtures/leaguedashteamstats-base.json');
const TEAM_ADVANCED_FIXTURE = loadFixture('../semantic/fixtures/leaguedashteamstats.json');
const TEAM_STANDINGS_FIXTURE = loadFixture('../semantic/fixtures/leaguestandingsv3.json');
const TEAM_STANDINGS_CURRENT_FIXTURE = loadFixture('../semantic/fixtures/leaguestandingsv3-current.json');
const CURRY_CAREER_FIXTURE = loadFixture('../semantic/fixtures/playercareerstats-curry.json');
const LILLARD_CAREER_FIXTURE = loadFixture('../semantic/fixtures/playercareerstats-lillard.json');
const ACHIUWA_CAREER_FIXTURE = loadFixture('../semantic/fixtures/playercareerstats-achiuwa.json');
const JOKIC_TREND_FIXTURE = loadFixture('../semantic/fixtures/playergamelog-jokic.json');
const ACHIUWA_TREND_FIXTURE = loadFixture('../semantic/fixtures/playergamelog-achiuwa.json');

const DETERMINISTIC_FIXTURE_ENTRIES: DeterministicFixtureEntry[] = [
	{
		endpointId: 'leaguedashplayerstats',
		params: buildDeterministicPlayerSeasonStatsParams('2023-24'),
		payload: PLAYER_SEASON_FIXTURE
	},
	{
		endpointId: 'leaguedashplayerstats',
		params: buildDeterministicPlayerSeasonStatsParams('2025-26'),
		payload: PLAYER_SEASON_FIXTURE
	},
	{
		endpointId: 'leaguedashteamstats',
		params: buildTeamSeasonStatsParams('2023-24', 'Base'),
		payload: TEAM_BASE_FIXTURE
	},
	{
		endpointId: 'leaguedashteamstats',
		params: buildTeamSeasonStatsParams('2025-26', 'Base'),
		payload: TEAM_BASE_FIXTURE
	},
	{
		endpointId: 'leaguedashteamstats',
		params: buildTeamSeasonStatsParams('2023-24', 'Advanced'),
		payload: TEAM_ADVANCED_FIXTURE
	},
	{
		endpointId: 'leaguedashteamstats',
		params: buildTeamSeasonStatsParams('2025-26', 'Advanced'),
		payload: TEAM_ADVANCED_FIXTURE
	},
	{
		endpointId: 'leaguestandingsv3',
		params: buildLeagueStandingsParams('2023-24'),
		payload: TEAM_STANDINGS_FIXTURE
	},
	{
		endpointId: 'leaguestandingsv3',
		params: buildLeagueStandingsParams('2025-26'),
		payload: TEAM_STANDINGS_CURRENT_FIXTURE
	},
	{
		endpointId: 'playercareerstats',
		params: buildPlayerCareerParams('201939'),
		payload: CURRY_CAREER_FIXTURE
	},
	{
		endpointId: 'playercareerstats',
		params: buildPlayerCareerParams('203081'),
		payload: LILLARD_CAREER_FIXTURE
	},
	{
		endpointId: 'playercareerstats',
		params: buildPlayerCareerParams('1630173'),
		payload: ACHIUWA_CAREER_FIXTURE
	},
	{
		endpointId: 'playergamelog',
		params: buildPlayerTrendParams('203999', '2023-24'),
		payload: JOKIC_TREND_FIXTURE
	},
	{
		endpointId: 'playergamelog',
		params: buildPlayerTrendParams('203999', '2025-26'),
		payload: JOKIC_TREND_FIXTURE
	},
	{
		endpointId: 'playergamelog',
		params: buildPlayerTrendParams('1630173', '2023-24'),
		payload: ACHIUWA_TREND_FIXTURE
	},
	{
		endpointId: 'playergamelog',
		params: buildPlayerTrendParams('1630173', '2025-26'),
		payload: ACHIUWA_TREND_FIXTURE
	}
];

const LOOKUP_FIXTURE_REQUIREMENTS: DeterministicLookupFixtureRequirement[] = [
	{
		endpointId: 'leaguedashplayerstats',
		params: buildDeterministicPlayerSeasonStatsParams('2023-24'),
		metricIds: ['pts', 'ast', 'reb', 'fg3_pct'],
		requiredColumns: ['PLAYER_ID', 'PLAYER_NAME', 'PTS', 'AST', 'REB', 'FG3_PCT']
	},
	{
		endpointId: 'leaguedashplayerstats',
		params: buildDeterministicPlayerSeasonStatsParams('2025-26'),
		metricIds: ['pts', 'ast', 'reb', 'fg3_pct'],
		requiredColumns: ['PLAYER_ID', 'PLAYER_NAME', 'PTS', 'AST', 'REB', 'FG3_PCT']
	},
	{
		endpointId: 'leaguedashteamstats',
		params: buildTeamSeasonStatsParams('2023-24', 'Base'),
		metricIds: ['wins', 'losses', 'win_pct', 'reb'],
		requiredColumns: ['TEAM_ID', 'TEAM_NAME', 'W', 'L', 'W_PCT', 'REB']
	},
	{
		endpointId: 'leaguedashteamstats',
		params: buildTeamSeasonStatsParams('2025-26', 'Base'),
		metricIds: ['wins', 'losses', 'win_pct', 'reb'],
		requiredColumns: ['TEAM_ID', 'TEAM_NAME', 'W', 'L', 'W_PCT', 'REB']
	},
	{
		endpointId: 'leaguestandingsv3',
		params: buildLeagueStandingsParams('2023-24'),
		metricIds: ['conference_rank', 'seed', 'wins', 'losses', 'win_pct', 'games_back', 'streak'],
		requiredColumns: ['TeamID', 'TeamCity', 'TeamName', 'Conference', 'Division', 'PlayoffRank', 'WINS', 'LOSSES', 'WinPCT', 'ConferenceGamesBack', 'strCurrentStreak']
	},
	{
		endpointId: 'leaguestandingsv3',
		params: buildLeagueStandingsParams('2025-26'),
		metricIds: ['conference_rank', 'seed', 'wins', 'losses', 'win_pct', 'games_back', 'streak'],
		requiredColumns: ['TeamID', 'TeamCity', 'TeamName', 'Conference', 'Division', 'PlayoffRank', 'WINS', 'LOSSES', 'WinPCT', 'ConferenceGamesBack', 'strCurrentStreak']
	},
	{
		endpointId: 'leaguedashteamstats',
		params: buildTeamSeasonStatsParams('2023-24', 'Advanced'),
		metricIds: ['ortg', 'drtg'],
		requiredColumns: ['TEAM_ID', 'TEAM_NAME', 'OFF_RATING', 'DEF_RATING']
	},
	{
		endpointId: 'leaguedashteamstats',
		params: buildTeamSeasonStatsParams('2025-26', 'Advanced'),
		metricIds: ['ortg', 'drtg'],
		requiredColumns: ['TEAM_ID', 'TEAM_NAME', 'OFF_RATING', 'DEF_RATING']
	}
];

const FIXTURE_BY_KEY = new Map(
	DETERMINISTIC_FIXTURE_ENTRIES.map((entry) => [
		buildFixtureKey({
			endpointId: entry.endpointId,
			params: entry.params
		}),
		entry.payload
	])
);

/* Public deterministic fixture API */

export function listDeterministicFixtureEntries(): DeterministicFixtureEntry[] {
	return DETERMINISTIC_FIXTURE_ENTRIES.map((entry) => ({
		endpointId: entry.endpointId,
		params: normalizeParams(entry.params),
		payload: entry.payload
	}));
}

export function listDeterministicLookupFixtureSurface(): DeterministicLookupFixtureRequirement[] {
	return LOOKUP_FIXTURE_REQUIREMENTS.map((requirement) => ({
		endpointId: requirement.endpointId,
		params: normalizeParams(requirement.params),
		metricIds: [...requirement.metricIds],
		requiredColumns: [...requirement.requiredColumns]
	}));
}

export function findDeterministicFixturePayload(
	request: Pick<EndpointFetchRequest, 'endpointId' | 'params'>
): unknown | null {
	return FIXTURE_BY_KEY.get(buildFixtureKey({
		endpointId: request.endpointId,
		params: normalizeParams(request.params)
	})) ?? null;
}
