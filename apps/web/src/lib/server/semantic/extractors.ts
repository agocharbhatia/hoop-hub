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
	drtg: 'DEF_RATING'
};

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
