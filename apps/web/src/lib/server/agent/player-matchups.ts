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

export type DefenderMatchupRankingMetric =
	| 'fgPct'
	| 'fg3Pct'
	| 'partialPossessions'
	| 'points'
	| 'fga'
	| 'fg3a'
	| 'assists'
	| 'turnovers';

export type DefenderMatchupLeaderboardRequest = {
	defensivePlayerId: string;
	season: string;
	seasonType: 'Regular Season' | 'Playoffs';
	metric: DefenderMatchupRankingMetric;
	direction: 'asc' | 'desc';
	limit: number;
	minGames: number;
	minFga: number;
	minFg3a: number;
	minPartialPossessions: number;
};

export type DefenderMatchupLeaderboardData = {
	endpointId: 'leagueseasonmatchups';
	found: boolean;
	attribution: PlayerMatchupData['attribution'];
	filters: Pick<DefenderMatchupLeaderboardRequest, 'minGames' | 'minFga' | 'minFg3a' | 'minPartialPossessions'>;
	ranking: Pick<DefenderMatchupLeaderboardRequest, 'metric' | 'direction' | 'limit'>;
	qualifyingMatchups: number;
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
 * Requests every tracked offensive matchup for one defender so ranking remains server-owned.
 */
export function buildDefenderMatchupLeaderboardEndpointRequest(
	request: DefenderMatchupLeaderboardRequest
): EndpointFetchRequest {
	return {
		endpointId: 'leagueseasonmatchups',
		params: {
			DefPlayerID: request.defensivePlayerId,
			DefTeamID: '',
			LeagueID: '00',
			OffPlayerID: '',
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
	const attribution = buildAttribution();

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

	const row = buildMatchupRow(sourceRow, resultSet.headers);
	const games = Number(row.games);
	const fga = Number(row.fga);
	const partialPossessions = Number(row.partialPossessions);
	const smallSample = games < 3 || fga < 10 || partialPossessions < 25;

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

/**
 * Ranks all qualifying tracked offensive matchups for one defender with explicit sample floors.
 */
export function parseDefenderMatchupLeaderboardPayload(
	payload: unknown,
	request: DefenderMatchupLeaderboardRequest
): DefenderMatchupLeaderboardData {
	const resultSet = readSeasonMatchups(payload);
	const defPlayerIdIndex = columnIndex(resultSet.headers, 'DEF_PLAYER_ID');
	const rows = resultSet.rows
		.filter((row) => String(row[defPlayerIdIndex] ?? '') === request.defensivePlayerId)
		.map((row) => buildMatchupRow(row, resultSet.headers))
		.filter(
			(row) =>
				Number(row.games) >= request.minGames &&
				Number(row.fga) >= request.minFga &&
				Number(row.fg3a) >= request.minFg3a &&
				Number(row.partialPossessions) >= request.minPartialPossessions &&
				Number.isFinite(Number(row[request.metric])) &&
				hasRequiredPercentageDenominator(row, request.metric)
		)
		.sort((left, right) => compareRankedRows(left, right, request.metric, request.direction));
	const rankedRows = rows.slice(0, request.limit).map((row, index) => ({ rank: index + 1, ...row }));

	return {
		endpointId: 'leagueseasonmatchups',
		found: rankedRows.length > 0,
		attribution: buildAttribution(),
		filters: {
			minGames: request.minGames,
			minFga: request.minFga,
			minFg3a: request.minFg3a,
			minPartialPossessions: request.minPartialPossessions
		},
		ranking: { metric: request.metric, direction: request.direction, limit: request.limit },
		qualifyingMatchups: rows.length,
		columns: ['rank', ...MATCHUP_COLUMNS],
		rows: rankedRows
	};
}

/* Helper functions */

function buildAttribution(): PlayerMatchupData['attribution'] {
	return {
		level: 'tracking_derived',
		provider: 'NBA Advanced Stats Player Tracking',
		confidence: 'high',
		description:
			'NBA matchup possessions are derived using Advanced Stats Player Tracking analysis; they are not manual event-by-event defender labels.'
	};
}

function buildMatchupRow(sourceRow: unknown[], headers: string[]): StatsQueryRow {
	return {
		offensivePlayer: stringValue(sourceRow, headers, 'OFF_PLAYER_NAME'),
		defensivePlayer: stringValue(sourceRow, headers, 'DEF_PLAYER_NAME'),
		games: numericValue(sourceRow, headers, 'GP'),
		matchupMinutes: stringValue(sourceRow, headers, 'MATCHUP_MIN'),
		partialPossessions: numericValue(sourceRow, headers, 'PARTIAL_POSS'),
		points: numericValue(sourceRow, headers, 'PLAYER_PTS'),
		fgm: numericValue(sourceRow, headers, 'MATCHUP_FGM'),
		fga: numericValue(sourceRow, headers, 'MATCHUP_FGA'),
		fgPct: numericValue(sourceRow, headers, 'MATCHUP_FG_PCT'),
		fg3m: numericValue(sourceRow, headers, 'MATCHUP_FG3M'),
		fg3a: numericValue(sourceRow, headers, 'MATCHUP_FG3A'),
		fg3Pct: numericValue(sourceRow, headers, 'MATCHUP_FG3_PCT'),
		assists: numericValue(sourceRow, headers, 'MATCHUP_AST'),
		turnovers: numericValue(sourceRow, headers, 'MATCHUP_TOV')
	};
}

function compareRankedRows(
	left: StatsQueryRow,
	right: StatsQueryRow,
	metric: DefenderMatchupRankingMetric,
	direction: 'asc' | 'desc'
): number {
	const metricDifference = Number(left[metric]) - Number(right[metric]);
	if (metricDifference !== 0) return direction === 'asc' ? metricDifference : -metricDifference;
	const sampleDifference = Number(right.partialPossessions) - Number(left.partialPossessions);
	if (sampleDifference !== 0) return sampleDifference;
	return String(left.offensivePlayer).localeCompare(String(right.offensivePlayer));
}

function hasRequiredPercentageDenominator(row: StatsQueryRow, metric: DefenderMatchupRankingMetric): boolean {
	if (metric === 'fgPct') return Number(row.fga) > 0;
	if (metric === 'fg3Pct') return Number(row.fg3a) > 0;
	return true;
}

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
