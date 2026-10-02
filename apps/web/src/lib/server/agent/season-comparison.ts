import type { QueryAnswerAgentToolResult, QueryAnswerArtifact } from '$lib/contracts/answer-response';
import type { StatsQueryRow, StatsQueryRowValue } from '$lib/contracts/semantic-query';
import { findTeamDirectoryEntryById } from '$lib/server/teams/team-directory';
import type { ResolvedResearchPlayer } from './research-context';

/** Builds comparison evidence per source scope rather than letting the last season overwrite both. */
export function buildSeasonComparisonTables(results: QueryAnswerAgentToolResult[], players: readonly ResolvedResearchPlayer[] = []): QueryAnswerArtifact[] {
	const playerNames = new Map(players.map((player) => [player.id, player.canonicalName]));
	const tables = new Map<string, Extract<QueryAnswerArtifact, { type: 'table' }>>();
	const shootingBars = new Map<string, { scope: string; values: Map<string, number> }>();
	const timeSeries = new Map<string, Array<{ name: string; points: Array<{ x: string | number; y: number }> }>>();
	const semanticSeries = new Map<string, { metric: string; name: string; points: Array<{ x: string; y: number }> }>();
	let sampledRows = false;
	for (const result of results) {
		if (!result.response.ok || !isRecord(result.response.data)) continue;
		const data = result.response.data;
		const season = readRequestSeason(result.request);
		if (!season) continue;
		const populationKey = `${result.toolName}|${serializePopulation(result.request)}`;
		const scope = describePopulation(result.request, data, playerNames);
		let rows: StatsQueryRow[] = [];
		let columns: string[] = [];
		if (result.toolName === 'call_nba_stats_endpoint' && Array.isArray(data.resultSets)) {
			for (const set of data.resultSets.filter(isRecord)) {
				const headers = readColumns(set.headers);
				if (!headers.length || !Array.isArray(set.rows)) continue;
				const rawRows = set.rows.filter(Array.isArray).map((row) => readRow(Object.fromEntries(headers.map((column, index) => [column, row[index] ?? null]))));
				appendTable(tables, `${populationKey}|${String(set.name)}|${headers.join('|')}`, season, scope, headers, rawRows);
				sampledRows ||= set.truncated === true;
			}
			continue;
		}
		if (result.toolName === 'execute_semantic_query' && data.status === 'ok' && isRecord(data.result)) {
			columns = readColumns(data.result.columns);
			rows = readRows(data.result.rows);
			const metrics = isRecord(result.request.query) ? readColumns(result.request.query.metrics) : [];
			for (const row of rows) {
				for (const metric of metrics) {
					if (typeof row[metric] !== 'number') continue;
					const name = String(row.playerName ?? row.teamName ?? row.playerId ?? row.teamId ?? 'Value');
					const key = `${populationKey}|${name}|${metric}`;
					const series = semanticSeries.get(key) ?? { name: name === scope ? name : `${name} · ${scope}`, metric, points: [] };
					series.points.push({ x: season, y: row[metric] });
					semanticSeries.set(key, series);
				}
			}
		} else if (result.toolName === 'analyze_player_matchup' || result.toolName === 'rank_defender_matchups') {
			columns = readColumns(data.columns);
			rows = readRows(data.rows);
		} else if (result.toolName === 'aggregate_endpoint_rows' && Array.isArray(data.groups)) {
			rows = data.groups.filter(isRecord).map((group) => ({
				...readRow(group.key), sampleSize: typeof group.rowCount === 'number' ? group.rowCount : null,
				...readRow(group.aggregates)
			}));
			const resultFiltered = Array.isArray(result.request.filters) && result.request.filters.some((filter) => isRecord(filter) && String(filter.column).toUpperCase() === 'SHOT_MADE_FLAG');
			const groupedByResult = Array.isArray(result.request.groupBy) && result.request.groupBy.some((column) => String(column).toUpperCase() === 'SHOT_MADE_FLAG');
			const contextMeasure = isRecord(result.request.params) ? result.request.params.ContextMeasure : undefined;
			if (!resultFiltered && !groupedByResult && contextMeasure !== 'FGM' && contextMeasure !== 'FG3M') {
				for (const row of rows) {
					if (typeof row['sum:SHOT_MADE_FLAG'] === 'number' && typeof row.sampleSize === 'number') row.fgPct = row.sampleSize > 0 ? row['sum:SHOT_MADE_FLAG'] / row.sampleSize : null;
				}
			}
			columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
		} else if (result.toolName === 'find_video_clips' && isRecord(data.shootingSummary)) {
			rows = [readRow(data.shootingSummary)];
			columns = ['attempts', 'makes', 'fgPct'];
		} else if (result.toolName === 'analyze_time_series' && Array.isArray(data.points)) {
			const points = data.points.filter(isRecord).flatMap((point) =>
				(typeof point.x === 'string' || typeof point.x === 'number') && typeof point.y === 'number'
					? [{ x: point.x, y: point.y }] : []
			);
			const metric = String(data.valueColumn ?? result.request.valueColumn ?? 'Value');
			const series = timeSeries.get(metric) ?? [];
			series.push({ name: `${season} · ${scope}`, points });
			timeSeries.set(metric, series);
			rows = [{ metric, earlierAverage: readNumber(isRecord(data.earlierWindow) ? data.earlierWindow.average : null),
				recentAverage: readNumber(isRecord(data.recentWindow) ? data.recentWindow.average : null), change: readNumber(data.change) }];
			columns = ['metric', 'earlierAverage', 'recentAverage', 'change'];
		}
		if (!columns.length) continue;
		appendTable(tables, `${populationKey}|${columns.join('|')}`, season, scope, columns, rows);
		if (rows.length === 1 && typeof rows[0].fgPct === 'number') {
			const chart = shootingBars.get(populationKey) ?? { scope, values: new Map<string, number>() };
			chart.values.set(season, rows[0].fgPct * 100);
			shootingBars.set(populationKey, chart);
		}
	}
	const metricSeries = new Map<string, Array<{ name: string; points: Array<{ x: string; y: number }> }>>();
	for (const series of semanticSeries.values()) {
		if (series.points.length < 2) continue;
		metricSeries.set(series.metric, [...metricSeries.get(series.metric) ?? [], { name: series.name, points: series.points }]);
	}
	return [
		...tables.values(),
		...[...shootingBars.values()].filter((chart) => chart.values.size >= 2).map((chart) => ({ type: 'bar_chart' as const, title: `Shooting percentage · ${chart.scope}`, xLabel: 'Season', yLabel: 'FG%', bars: [...chart.values].map(([label, value]) => ({ label, value })) })),
		...[...timeSeries].filter(([, series]) => series.length >= 2).map(([metric, series]) => ({ type: 'line_chart' as const, title: `${metric.toUpperCase()} season comparison`, xLabel: 'Game date', yLabel: metric.toUpperCase(), series })),
		...[...metricSeries].map(([metric, series]) => ({ type: 'line_chart' as const, title: `${metric.toUpperCase()} by season`, xLabel: 'Season', yLabel: metric.toUpperCase(), series })),
		...(sampledRows ? [{ type: 'text_block' as const, text: 'Some comparison tables include a sample of the available rows.' }] : [])
	];
}

export function readRequestSeason(request: Record<string, unknown>): string | null {
	if (typeof request.season === 'string') return request.season;
	if (isRecord(request.params) && typeof request.params.Season === 'string') return request.params.Season;
	if (isRecord(request.query) && isRecord(request.query.filters) && typeof request.query.filters.season === 'string') return request.query.filters.season;
	return null;
}

/* Helper functions */

function appendTable(tables: Map<string, Extract<QueryAnswerArtifact, { type: 'table' }>>, key: string, season: string, scope: string, columns: string[], rows: StatsQueryRow[]): void {
	const table = tables.get(key) ?? { type: 'table', shape: 'comparison', columns: ['season', 'scope', ...columns], rows: [] };
	table.rows.push(...rows.map((row) => ({ season, scope, ...row })));
	tables.set(key, table);
}

function serializePopulation(request: Record<string, unknown>): string {
	const scope = structuredClone(request);
	delete scope.season; delete scope.question;
	if (isRecord(scope.params)) delete scope.params.Season;
	if (isRecord(scope.query) && isRecord(scope.query.filters)) delete scope.query.filters.season;
	const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : isRecord(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sort(item)])) : value;
	return JSON.stringify(sort(scope));
}

function describePopulation(request: Record<string, unknown>, data: Record<string, unknown>, playerNames: ReadonlyMap<string, string>): string {
	const params = isRecord(request.params) ? request.params : {};
	const query = isRecord(request.query) ? request.query : {};
	const subject = isRecord(query.subject) ? query.subject : {};
	const firstRow = readRows(data.researchRows ?? data.selectedRows ?? (isRecord(data.result) ? data.result.rows : data.rows))[0];
	const id = request.playerId ?? request.offensivePlayerId ?? request.defensivePlayerId ?? params.PlayerID ?? params.TeamID;
	const labels = [readColumns(subject.names).join(', ') || String(firstRow?.playerName ?? firstRow?.PLAYER_NAME ?? firstRow?.teamName ?? playerNames.get(String(id)) ?? (id && id !== '0' ? `Player ${id}` : 'All qualifying rows'))];
	const opponent = request.opponentTeamId ?? params.OpponentTeamID;
	if (typeof opponent === 'string' && opponent !== '0') labels.push(`vs ${findTeamDirectoryEntryById(opponent)?.canonicalName ?? `Team ${opponent}`}`);
	const custom = isRecord(request.customShot) ? request.customShot : {};
	for (const value of [custom.actionFamily, custom.zone]) if (typeof value === 'string') labels.push(value.replaceAll('_', ' '));
	if (custom.period || (params.Period && params.Period !== '0')) labels.push(`Q${custom.period ?? params.Period}`);
	for (const filter of Array.isArray(request.filters) ? request.filters.filter(isRecord) : []) {
		if (['ACTION_TYPE', 'SHOT_ZONE_BASIC', 'SHOT_ZONE_AREA'].includes(String(filter.column).toUpperCase())) labels.push(String(filter.value ?? (Array.isArray(filter.values) ? filter.values.join(', ') : '')));
	}
	return labels.filter(Boolean).join(' · ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readColumns(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function readRows(value: unknown): StatsQueryRow[] {
	return Array.isArray(value) ? value.filter(isRecord).map(readRow) : [];
}

function readRow(value: unknown): StatsQueryRow {
	if (!isRecord(value)) return {};
	return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, StatsQueryRowValue] =>
		entry[1] === null || typeof entry[1] === 'string' || typeof entry[1] === 'number' || typeof entry[1] === 'boolean'
	));
}

function readNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/* End helper functions */
