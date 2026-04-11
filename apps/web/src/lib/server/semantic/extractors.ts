import type {
	SemanticQueryOrderBy,
	SemanticQueryWindow,
	StatsQueryResult,
	StatsQueryRow
} from '$lib/contracts/semantic-query';

type ResultSet = {
	headers: string[];
	rowSet: unknown[][];
};

type ComparisonPayload = {
	subject: string;
	payload: unknown;
};

const PLAYER_METRIC_COLUMNS: Record<string, string> = {
	ast: 'AST',
	pts: 'PTS',
	reb: 'REB'
};

const TEAM_METRIC_COLUMNS: Record<string, string> = {
	wins: 'W',
	losses: 'L',
	win_pct: 'W_PCT',
	reb: 'REB',
	ortg: 'OFF_RATING',
	drtg: 'DEF_RATING'
};

const TEAM_STANDINGS_METRIC_COLUMNS: Record<string, string> = {
	conference_rank: 'PlayoffRank',
	seed: 'PlayoffRank',
	wins: 'WINS',
	losses: 'LOSSES',
	win_pct: 'WinPCT',
	games_back: 'ConferenceGamesBack',
	streak: 'strCurrentStreak'
};

type TeamStandingsFilters = {
	conference?: string | null;
	division?: string | null;
};

type TeamStandingsSortDefaults = Record<string, 'asc' | 'desc'>;

export class SemanticExtractionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SemanticExtractionError';
	}
}

function normalizeNumber(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string') {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	throw new SemanticExtractionError(`Unable to normalize numeric value '${String(value)}'.`);
}

function formatMetricLabel(metricId: string): string {
	return metricId.toUpperCase();
}

function extractResultSet(payload: unknown, expectedNames?: string[]): ResultSet {
	if (!payload || typeof payload !== 'object') {
		throw new SemanticExtractionError('Payload is not an object.');
	}

	const candidate = payload as {
		resultSet?: { name?: string; headers?: unknown; rowSet?: unknown };
		resultSets?: Array<{ name?: string; headers?: unknown; rowSet?: unknown }>;
	};

	if (candidate.resultSet && Array.isArray(candidate.resultSet.headers) && Array.isArray(candidate.resultSet.rowSet)) {
		return {
			headers: candidate.resultSet.headers.map((value) => String(value)),
			rowSet: candidate.resultSet.rowSet as unknown[][]
		};
	}

	if (!Array.isArray(candidate.resultSets)) {
		throw new SemanticExtractionError('Payload does not contain a readable result set.');
	}

	const normalizedNames = new Set(expectedNames ?? []);
	const match =
		candidate.resultSets.find(
			(resultSet) =>
				normalizedNames.size > 0 &&
				typeof resultSet.name === 'string' &&
				normalizedNames.has(resultSet.name) &&
				Array.isArray(resultSet.headers) &&
				Array.isArray(resultSet.rowSet)
		) ??
		candidate.resultSets.find((resultSet) => Array.isArray(resultSet.headers) && Array.isArray(resultSet.rowSet));

	if (!match || !Array.isArray(match.headers) || !Array.isArray(match.rowSet)) {
		throw new SemanticExtractionError('Payload does not contain a readable result set.');
	}

	return {
		headers: match.headers.map((value) => String(value)),
		rowSet: match.rowSet as unknown[][]
	};
}

function getColumnIndex(headers: string[], columnName: string): number {
	const index = headers.indexOf(columnName);
	if (index < 0) {
		throw new SemanticExtractionError(`Missing expected column '${columnName}'.`);
	}
	return index;
}

function sortRowsByDirection<T extends StatsQueryRow>(rows: T[], direction: 'asc' | 'desc'): T[] {
	return [...rows].sort((left, right) => {
		const leftValue = normalizeNumber(left.value);
		const rightValue = normalizeNumber(right.value);
		return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
	});
}

function normalizeStreakValue(value: unknown): number {
	const normalizedValue = String(value ?? '').trim().toUpperCase();
	const match = normalizedValue.match(/^([WL])\s*(\d+)$/);
	if (!match) {
		throw new SemanticExtractionError(`Unable to normalize standings streak value '${String(value)}'.`);
	}

	const length = Number.parseInt(match[2] ?? '', 10);
	if (!Number.isInteger(length)) {
		throw new SemanticExtractionError(`Unable to normalize standings streak value '${String(value)}'.`);
	}

	return match[1] === 'W' ? length : -length;
}

function matchesStandingsFilters(
	row: unknown[],
	resultSet: ResultSet,
	filters?: TeamStandingsFilters
): boolean {
	const conferenceIndex = getColumnIndex(resultSet.headers, 'Conference');
	const divisionIndex = getColumnIndex(resultSet.headers, 'Division');
	const conference = String(row[conferenceIndex] ?? '');
	const division = String(row[divisionIndex] ?? '');

	if (filters?.conference && filters.conference !== conference) {
		return false;
	}

	if (filters?.division && filters.division !== division) {
		return false;
	}

	return true;
}

function getStandingsMetricSortableValue(metric: string, rawValue: unknown): number {
	if (metric === 'streak') {
		return normalizeStreakValue(rawValue);
	}

	return normalizeNumber(rawValue);
}

function getStandingsMetricDisplayValue(metric: string, rawValue: unknown): string | number {
	return metric === 'streak' ? String(rawValue ?? '') : normalizeNumber(rawValue);
}

export function extractPlayerRankingRows(
	payload: unknown,
	metrics: string[],
	limit: number,
	orderBy: SemanticQueryOrderBy | null,
	seasonLabel = 'this season'
): StatsQueryResult {
	const resultSet = extractResultSet(payload, ['LeagueDashPlayerStats']);
	const playerNameIndex = getColumnIndex(resultSet.headers, 'PLAYER_NAME');
	const rows: StatsQueryRow[] = [];

	for (const metric of metrics) {
		const columnName = PLAYER_METRIC_COLUMNS[metric];
		if (!columnName) {
			throw new SemanticExtractionError(`Unsupported player ranking metric '${metric}'.`);
		}

		const metricIndex = getColumnIndex(resultSet.headers, columnName);
		const direction = orderBy?.metric === metric ? orderBy.direction : 'desc';
		const rankedRows = sortRowsByDirection(
			resultSet.rowSet.map((row) => ({
				subject: String(row[playerNameIndex] ?? 'Unknown Player'),
				metric,
				value: normalizeNumber(row[metricIndex] ?? 0)
			})),
			direction
		)
			.slice(0, limit)
			.map((row, index) => ({
				rank: index + 1,
				...row
			}));

		rows.push(...rankedRows);
	}

	if (rows.length === 0) {
		throw new SemanticExtractionError('No ranking rows could be extracted.');
	}

	const firstLeader = rows[0];
	return {
		shape: 'ranking',
		columns: ['rank', 'subject', 'metric', 'value'],
		rows,
		summary: `${firstLeader.subject} leads ${formatMetricLabel(String(firstLeader.metric))} rankings for ${seasonLabel} at ${firstLeader.value}.`
	};
}

export function extractPlayerLookupRow(
	payload: unknown,
	subject: { playerId: string; playerName: string },
	metrics: string[],
	season: string,
	seasonType: string
): StatsQueryResult {
	const resultSet = extractResultSet(payload, ['LeagueDashPlayerStats']);
	const playerIdIndex = getColumnIndex(resultSet.headers, 'PLAYER_ID');
	const seasonRow = resultSet.rowSet.find((row) => String(row[playerIdIndex] ?? '') === subject.playerId);

	if (!seasonRow) {
		throw new SemanticExtractionError(`No season row could be resolved for ${subject.playerName}.`);
	}

	const row: StatsQueryRow = {
		playerId: subject.playerId,
		playerName: subject.playerName,
		season,
		seasonType
	};

	for (const metric of metrics) {
		const columnName = PLAYER_METRIC_COLUMNS[metric];
		if (!columnName) {
			throw new SemanticExtractionError(`Unsupported player lookup metric '${metric}'.`);
		}

		const metricIndex = getColumnIndex(resultSet.headers, columnName);
		row[metric] = normalizeNumber(seasonRow[metricIndex] ?? 0);
	}

	return {
		shape: 'table',
		columns: ['playerId', 'playerName', 'season', 'seasonType', ...metrics],
		rows: [row],
		summary: `Returned ${subject.playerName} season metrics for ${season}.`
	};
}

export function extractPlayerTrendRows(
	payload: unknown,
	metrics: string[],
	window: SemanticQueryWindow | null,
	limit: number | null,
	subject = 'Selected player'
): StatsQueryResult {
	const resultSet = extractResultSet(payload, ['PlayerGameLog']);
	const labelIndex = getColumnIndex(resultSet.headers, 'GAME_DATE');
	const sampleSize = limit ?? window?.n ?? resultSet.rowSet.length;
	const filteredRows = resultSet.rowSet.slice(0, window?.n ?? resultSet.rowSet.length).slice(0, sampleSize);
	const rows: StatsQueryRow[] = [];

	for (const metric of metrics) {
		const columnName = PLAYER_METRIC_COLUMNS[metric];
		if (!columnName) {
			throw new SemanticExtractionError(`Unsupported player trend metric '${metric}'.`);
		}

		const metricIndex = getColumnIndex(resultSet.headers, columnName);
		for (const row of filteredRows) {
			rows.push({
				label: String(row[labelIndex] ?? 'Unknown Game'),
				metric,
				value: normalizeNumber(row[metricIndex] ?? 0)
			});
		}
	}

	if (rows.length === 0) {
		throw new SemanticExtractionError('No trend rows could be extracted.');
	}

	return {
		shape: 'timeseries',
		columns: ['label', 'metric', 'value'],
		rows,
		summary: `Returned ${filteredRows.length} game samples for ${subject} across ${metrics.map(formatMetricLabel).join(', ')}.`
	};
}

export function extractPlayerComparisonRows(
	subjectPayloads: ComparisonPayload[],
	metrics: string[],
	season: string
): StatsQueryResult {
	const rows: StatsQueryRow[] = [];

	for (const subjectPayload of subjectPayloads) {
		const resultSet = extractResultSet(subjectPayload.payload, ['SeasonTotalsRegularSeason']);
		const seasonIndex = getColumnIndex(resultSet.headers, 'SEASON_ID');
		const seasonRow =
			resultSet.rowSet.find((row) => String(row[seasonIndex] ?? '') === season) ?? resultSet.rowSet[resultSet.rowSet.length - 1];

		if (!seasonRow) {
			throw new SemanticExtractionError(`No season row could be resolved for ${subjectPayload.subject}.`);
		}

		for (const metric of metrics) {
			const columnName = PLAYER_METRIC_COLUMNS[metric];
			if (!columnName) {
				throw new SemanticExtractionError(`Unsupported player comparison metric '${metric}'.`);
			}

			const metricIndex = getColumnIndex(resultSet.headers, columnName);
			rows.push({
				subject: subjectPayload.subject,
				metric,
				value: normalizeNumber(seasonRow[metricIndex] ?? 0)
			});
		}
	}

	if (rows.length === 0) {
		throw new SemanticExtractionError('No comparison rows could be extracted.');
	}

	return {
		shape: 'comparison',
		columns: ['subject', 'metric', 'value'],
		rows,
		summary: `Compared ${subjectPayloads.map((item) => item.subject).join(' vs ')} across ${metrics.map(formatMetricLabel).join(', ')} for ${season}.`
	};
}

export function extractTeamRankingRows(
	payload: unknown,
	metric: string,
	limit: number,
	orderBy: SemanticQueryOrderBy | null,
	subjectFilter: { teamId: string; canonicalName: string } | null = null,
	seasonLabel = 'this season'
): StatsQueryResult {
	const resultSet = extractResultSet(payload, ['LeagueDashTeamStats']);
	const teamIdIndex = getColumnIndex(resultSet.headers, 'TEAM_ID');
	const teamNameIndex = getColumnIndex(resultSet.headers, 'TEAM_NAME');
	const columnName = TEAM_METRIC_COLUMNS[metric];
	if (!columnName) {
		throw new SemanticExtractionError(`Unsupported team ranking metric '${metric}'.`);
	}

	const metricIndex = getColumnIndex(resultSet.headers, columnName);
	const direction = orderBy?.metric === metric ? orderBy.direction : 'asc';
	const rows = sortRowsByDirection(
		resultSet.rowSet
			.filter((row) => subjectFilter === null || String(row[teamIdIndex] ?? '') === subjectFilter.teamId)
			.map((row) => ({
				subject: subjectFilter?.canonicalName ?? String(row[teamNameIndex] ?? 'Unknown Team'),
				metric,
				value: normalizeNumber(row[metricIndex] ?? 0)
			})),
		direction
	)
		.slice(0, limit)
		.map((row, index) => ({
			rank: index + 1,
			...row
		}));

	if (rows.length === 0) {
		throw new SemanticExtractionError('No team ranking rows could be extracted.');
	}

	return {
		shape: 'ranking',
		columns: ['rank', 'subject', 'metric', 'value'],
		rows,
		summary: `${rows[0].subject} lead team ${formatMetricLabel(metric)} rankings for ${seasonLabel} at ${rows[0].value}.`
	};
}

export function extractTeamLookupRow(
	payloads: { base: unknown; advanced: unknown },
	subject: { teamId: string; teamName: string },
	metrics: string[],
	season: string,
	seasonType: string
): StatsQueryResult {
	const resultSets = {
		base: extractResultSet(payloads.base, ['LeagueDashTeamStats']),
		advanced: extractResultSet(payloads.advanced, ['LeagueDashTeamStats'])
	};
	const baseTeamIdIndex = getColumnIndex(resultSets.base.headers, 'TEAM_ID');
	const advancedTeamIdIndex = getColumnIndex(resultSets.advanced.headers, 'TEAM_ID');
	const baseRow = resultSets.base.rowSet.find((row) => String(row[baseTeamIdIndex] ?? '') === subject.teamId);
	const advancedRow = resultSets.advanced.rowSet.find((row) => String(row[advancedTeamIdIndex] ?? '') === subject.teamId);

	if (!baseRow || !advancedRow) {
		throw new SemanticExtractionError(`No season row could be resolved for ${subject.teamName}.`);
	}

	const row: StatsQueryRow = {
		teamId: subject.teamId,
		teamName: subject.teamName,
		season,
		seasonType
	};

	for (const metric of metrics) {
		const columnName = TEAM_METRIC_COLUMNS[metric];
		if (!columnName) {
			throw new SemanticExtractionError(`Unsupported team lookup metric '${metric}'.`);
		}

		const source = metric === 'ortg' || metric === 'drtg' ? resultSets.advanced : resultSets.base;
		const sourceRow = metric === 'ortg' || metric === 'drtg' ? advancedRow : baseRow;
		const metricIndex = getColumnIndex(source.headers, columnName);
		row[metric] = normalizeNumber(sourceRow[metricIndex] ?? 0);
	}

	return {
		shape: 'table',
		columns: ['teamId', 'teamName', 'season', 'seasonType', ...metrics],
		rows: [row],
		summary: `Returned ${subject.teamName} season metrics for ${season}.`
	};
}

export function extractTeamStandingsRow(
	payload: unknown,
	subject: { teamId: string; teamName: string },
	metrics: string[],
	season: string,
	seasonType: string,
	filters?: TeamStandingsFilters
): StatsQueryResult {
	const resultSet = extractResultSet(payload, ['Standings']);
	const teamIdIndex = getColumnIndex(resultSet.headers, 'TeamID');
	const teamRow = resultSet.rowSet.find((row) => String(row[teamIdIndex] ?? '') === subject.teamId);

	if (!teamRow) {
		throw new SemanticExtractionError(`No standings row could be resolved for ${subject.teamName}.`);
	}

	if (!matchesStandingsFilters(teamRow, resultSet, filters)) {
		const conferenceIndex = getColumnIndex(resultSet.headers, 'Conference');
		const divisionIndex = getColumnIndex(resultSet.headers, 'Division');
		const conference = String(teamRow[conferenceIndex] ?? '');
		const division = String(teamRow[divisionIndex] ?? '');
		if (filters?.conference && filters.conference !== conference) {
			throw new SemanticExtractionError(`Resolved team ${subject.teamName} does not match conference filter '${filters.conference}'.`);
		}

		if (filters?.division && filters.division !== division) {
			throw new SemanticExtractionError(`Resolved team ${subject.teamName} does not match division filter '${filters.division}'.`);
		}
	}

	const row: StatsQueryRow = {
		teamId: subject.teamId,
		teamName: subject.teamName,
		season,
		seasonType
	};

	for (const metric of metrics) {
		const columnName = TEAM_STANDINGS_METRIC_COLUMNS[metric];
		if (!columnName) {
			throw new SemanticExtractionError(`Unsupported team standings metric '${metric}'.`);
		}

		const metricIndex = getColumnIndex(resultSet.headers, columnName);
		row[metric] = getStandingsMetricDisplayValue(metric, teamRow[metricIndex] ?? 0);
	}

	return {
		shape: 'table',
		columns: ['teamId', 'teamName', 'season', 'seasonType', ...metrics],
		rows: [row],
		summary: `Returned ${subject.teamName} standings for ${season}.`
	};
}

export function extractTeamStandingsRankingRows(
	payload: unknown,
	metrics: string[],
	limit: number,
	sortDefaults: TeamStandingsSortDefaults,
	seasonLabel = 'this season',
	filters?: TeamStandingsFilters
): StatsQueryResult {
	const resultSet = extractResultSet(payload, ['Standings']);
	const teamCityIndex = getColumnIndex(resultSet.headers, 'TeamCity');
	const teamNameIndex = getColumnIndex(resultSet.headers, 'TeamName');
	const filteredRows = resultSet.rowSet.filter((row) => matchesStandingsFilters(row, resultSet, filters));
	const rows: StatsQueryRow[] = [];

	for (const metric of metrics) {
		const columnName = TEAM_STANDINGS_METRIC_COLUMNS[metric];
		if (!columnName) {
			throw new SemanticExtractionError(`Unsupported team standings metric '${metric}'.`);
		}

		const metricIndex = getColumnIndex(resultSet.headers, columnName);
		const direction = sortDefaults[metric] ?? 'desc';
		const rankedRows = [...filteredRows]
			.sort((left, right) => {
				const leftValue = getStandingsMetricSortableValue(metric, left[metricIndex] ?? 0);
				const rightValue = getStandingsMetricSortableValue(metric, right[metricIndex] ?? 0);
				return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
			})
			.slice(0, limit)
			.map((row, index) => ({
				rank: index + 1,
				subject: `${String(row[teamCityIndex] ?? '').trim()} ${String(row[teamNameIndex] ?? '').trim()}`.trim(),
				metric,
				value: getStandingsMetricDisplayValue(metric, row[metricIndex] ?? 0)
			}));

		rows.push(...rankedRows);
	}

	if (rows.length === 0) {
		throw new SemanticExtractionError('No standings ranking rows could be extracted.');
	}

	const firstLeader = rows[0];
	return {
		shape: 'ranking',
		columns: ['rank', 'subject', 'metric', 'value'],
		rows,
		summary: `${firstLeader.subject} leads ${formatMetricLabel(String(firstLeader.metric))} standings for ${seasonLabel} at ${firstLeader.value}.`
	};
}
