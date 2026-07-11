import type { StatsQueryRow } from '$lib/contracts/semantic-query';
import type { EndpointFetchRequest } from '$lib/server/data/adapters';

export type PlayerMatchupRequest = {
	offensivePlayerId: string;
	defensivePlayerId: string;
	season: string;
	seasonType: 'Regular Season' | 'Playoffs';
};

export type PlayerMatchupData = {
	endpointId: 'leagueseasonmatchups';
	found: boolean;
	attribution: {
		level: 'tracking_derived';
		provider: 'NBA Advanced Stats Player Tracking';
		confidence: 'high';
		description: string;
	};
	sampleSize: {
		level: 'small' | 'established';
		description: string;
	};
	columns: string[];
	rows: StatsQueryRow[];
};

const MATCHUP_COLUMNS = [
	'offensivePlayer',
	'defensivePlayer',
	'games',
	'matchupMinutes',
	'partialPossessions',
	'points',
	'fgm',
	'fga',
	'fgPct',
	'fg3m',
	'fg3a',
	'fg3Pct',
	'assists',
	'turnovers'
];

/**
 * Builds the same official season-matchup request used by NBA.com's player head-to-head page.
 */
export function buildPlayerMatchupEndpointRequest(request: PlayerMatchupRequest): EndpointFetchRequest {
	return {
		endpointId: 'leagueseasonmatchups',
		params: {
			DefPlayerID: request.defensivePlayerId,
			DefTeamID: '',
			LeagueID: '00',
			OffPlayerID: request.offensivePlayerId,
			OffTeamID: '',
			PerMode: 'Totals',
			Season: request.season,
			SeasonType: request.seasonType
		}
	};
}

/**
 * Converts NBA tracking-derived matchup output into one canonical row and explicit evidence metadata.
 */
export function parsePlayerMatchupPayload(payload: unknown, request: PlayerMatchupRequest): PlayerMatchupData {
	const resultSet = readSeasonMatchups(payload);
	const offPlayerIdIndex = columnIndex(resultSet.headers, 'OFF_PLAYER_ID');
	const defPlayerIdIndex = columnIndex(resultSet.headers, 'DEF_PLAYER_ID');
	const sourceRow = resultSet.rows.find(
		(row) =>
			String(row[offPlayerIdIndex] ?? '') === request.offensivePlayerId &&
			String(row[defPlayerIdIndex] ?? '') === request.defensivePlayerId
	);
	const attribution = {
		level: 'tracking_derived' as const,
		provider: 'NBA Advanced Stats Player Tracking' as const,
		confidence: 'high' as const,
		description:
			'NBA matchup possessions are derived using Advanced Stats Player Tracking analysis; they are not manual event-by-event defender labels.'
	};

	if (!sourceRow) {
		return {
			endpointId: 'leagueseasonmatchups',
			found: false,
			attribution,
			sampleSize: {
				level: 'small',
				description: 'No tracked matchup possessions were returned for this player pair and scope.'
			},
			columns: MATCHUP_COLUMNS,
			rows: []
		};
	}

	const games = numericValue(sourceRow, resultSet.headers, 'GP');
	const fga = numericValue(sourceRow, resultSet.headers, 'MATCHUP_FGA');
	const partialPossessions = numericValue(sourceRow, resultSet.headers, 'PARTIAL_POSS');
	const smallSample = games < 3 || fga < 10 || partialPossessions < 25;
	const row: StatsQueryRow = {
		offensivePlayer: stringValue(sourceRow, resultSet.headers, 'OFF_PLAYER_NAME'),
		defensivePlayer: stringValue(sourceRow, resultSet.headers, 'DEF_PLAYER_NAME'),
		games,
		matchupMinutes: stringValue(sourceRow, resultSet.headers, 'MATCHUP_MIN'),
		partialPossessions,
		points: numericValue(sourceRow, resultSet.headers, 'PLAYER_PTS'),
		fgm: numericValue(sourceRow, resultSet.headers, 'MATCHUP_FGM'),
		fga,
		fgPct: numericValue(sourceRow, resultSet.headers, 'MATCHUP_FG_PCT'),
		fg3m: numericValue(sourceRow, resultSet.headers, 'MATCHUP_FG3M'),
		fg3a: numericValue(sourceRow, resultSet.headers, 'MATCHUP_FG3A'),
		fg3Pct: numericValue(sourceRow, resultSet.headers, 'MATCHUP_FG3_PCT'),
		assists: numericValue(sourceRow, resultSet.headers, 'MATCHUP_AST'),
		turnovers: numericValue(sourceRow, resultSet.headers, 'MATCHUP_TOV')
	};

	return {
		endpointId: 'leagueseasonmatchups',
		found: true,
		attribution,
		sampleSize: {
			level: smallSample ? 'small' : 'established',
			description: smallSample
				? `Small sample: ${games} game(s), ${fga} field-goal attempt(s), and ${partialPossessions} partial matchup possessions.`
				: `Sample includes ${games} games, ${fga} field-goal attempts, and ${partialPossessions} partial matchup possessions.`
		},
		columns: MATCHUP_COLUMNS,
		rows: [row]
	};
}

/* Helper functions */

function readSeasonMatchups(payload: unknown): { headers: string[]; rows: unknown[][] } {
	if (!payload || typeof payload !== 'object') throw new Error('Player matchup payload is not an object.');
	const resultSets = (payload as { resultSets?: unknown }).resultSets;
	if (!Array.isArray(resultSets)) throw new Error('Player matchup payload has no resultSets array.');
	const resultSet = resultSets.find(
		(value): value is { name: string; headers: unknown[]; rowSet: unknown[][] } =>
			typeof value === 'object' &&
			value !== null &&
			(value as { name?: unknown }).name === 'SeasonMatchups' &&
			Array.isArray((value as { headers?: unknown }).headers) &&
			Array.isArray((value as { rowSet?: unknown }).rowSet)
	);
	if (!resultSet) throw new Error("Player matchup payload has no 'SeasonMatchups' result set.");
	return { headers: resultSet.headers.map(String), rows: resultSet.rowSet };
}

function columnIndex(headers: string[], name: string): number {
	const index = headers.indexOf(name);
	if (index < 0) throw new Error(`Player matchup payload is missing '${name}'.`);
	return index;
}

function numericValue(row: unknown[], headers: string[], name: string): number {
	const value = Number(row[columnIndex(headers, name)]);
	if (!Number.isFinite(value)) throw new Error(`Player matchup field '${name}' is not numeric.`);
	return value;
}

function stringValue(row: unknown[], headers: string[], name: string): string {
	return String(row[columnIndex(headers, name)] ?? '');
}
