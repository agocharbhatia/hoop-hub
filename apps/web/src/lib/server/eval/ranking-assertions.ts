import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
import type { EvalExecution } from './types';
import { normalizeEndpointParams } from '$lib/server/data/adapters/stats-endpoint-client';

type RankingScope = { season: string; seasonType: string };

/** A sorted subset can still be the wrong ranking; compare against the fullest successful population. */
export function evaluateRankingGrounding(execution: EvalExecution, requestedCount: number, metric = 'ast', scope?: RankingScope): string[] {
	const chart = execution.response.artifacts.find((artifact): artifact is Extract<QueryAnswerArtifact, { type: 'bar_chart' }> => artifact.type === 'bar_chart');
	if (!chart) return ['ranking_grounding: ranking chart was missing'];
	const populations = execution.response.toolResults.flatMap((result) => {
		if (!('ok' in result.response) || !result.response.ok) return [];
		const data = result.response.data;
		if (!isRecord(data)) return [];
		if (result.toolName === 'execute_semantic_query') {
			const query = isRecord(result.request.query) ? result.request.query : null;
			if (query?.operation !== 'rank' || !isRecord(data.result) || !Array.isArray(data.result.rows)) return [];
			if (scope && !isUnfilteredSemanticRanking(query, metric, scope)) return [];
			return [readPopulation(data.result.rows, metric)];
		}
		if (result.toolName === 'aggregate_endpoint_rows') {
			if (!['leaguedashplayerstats', 'leagueleaders'].includes(String(result.request.endpointId))) return [];
			if (scope && !isUnfilteredEndpointRanking(result.request, metric, scope)) return [];
			if (!isCompleteOrderedSelection(result.request, data, metric, requestedCount)) return [];
			return [readPopulation(data.selectedRows as unknown[], metric)];
		}
		if (result.toolName !== 'call_nba_stats_endpoint' || !['leaguedashplayerstats', 'leagueleaders'].includes(String(result.request.endpointId))) return [];
		if (scope && !isUnfilteredEndpointRanking(result.request, metric, scope)) return [];
		if (!Array.isArray(data.resultSets)) return [];
		return data.resultSets.flatMap((resultSet) => {
			if (!isRecord(resultSet) || !Array.isArray(resultSet.headers)) return [];
			const rows = Array.isArray(resultSet.rows) ? resultSet.rows : resultSet.rowSet;
			if (!Array.isArray(rows)) return [];
			const headers = resultSet.headers;
			return [readPopulation(rows.filter(Array.isArray).map((row) => Object.fromEntries(headers.map((header, index) => [String(header), row[index]]))), metric)];
		});
	}).filter((population) => population.length > 0).sort((a, b) => b.length - a.length);
	const population = populations[0];
	if (!population) return ['ranking_grounding: no successful ranking population was retrieved'];
	const expectedCount = requestedCount;
	const sorted = [...population].sort((a, b) => b.value - a.value);
	const byName = new Map(population.map((row) => [normalize(row.name), row.value]));
	const failures: string[] = [];
	if (population.length < requestedCount) failures.push(`ranking_grounding: retrieved population has only ${population.length} subjects for a top-${requestedCount} request`);
	if (chart.bars.length !== expectedCount) failures.push(`ranking_grounding: expected ${expectedCount} ranked bars, received ${chart.bars.length}`);
	if (new Set(chart.bars.map((bar) => normalize(bar.label))).size !== chart.bars.length) failures.push('ranking_grounding: duplicate subjects appeared in the ranking');
	if (chart.bars.some((bar, index) => byName.get(normalize(bar.label)) !== bar.value || sorted[index]?.value !== bar.value)) {
		failures.push('ranking_grounding: labels, values or order disagree with the full retrieved population');
	}
	return failures;
}

// --- Source row helpers ---

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalize(value: string): string {
	return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

function readPopulation(rows: unknown[], metric: string): Array<{ name: string; value: number }> {
	return rows.flatMap((row) => {
		if (!isRecord(row)) return [];
		const columns = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/_/g, ''), value]));
		const name = columns.get('playername') ?? columns.get('player') ?? columns.get('subject');
		const metricKey = metric.toLowerCase().replace(/_/g, '');
		const value = columns.get(metricKey) ?? (String(columns.get('metric')).toLowerCase() === metricKey ? columns.get('value') : null);
		return typeof name === 'string' && typeof value === 'number' && Number.isFinite(value) ? [{ name, value }] : [];
	});
}

function isUnfilteredSemanticRanking(query: Record<string, unknown>, metric: string, scope: RankingScope): boolean {
	const filters = isRecord(query.filters) ? query.filters : {};
	const subject = isRecord(query.subject) ? query.subject : {};
	const order = isRecord(query.orderBy) ? query.orderBy : null;
	const firstMetric = Array.isArray(query.metrics) ? query.metrics[0] : null;
	return query.entity === 'player' && String(order?.metric ?? firstMetric).toLowerCase() === metric.toLowerCase()
		&& (order?.direction ?? 'desc') === 'desc'
		&& filters.season === scope.season && (filters.seasonType ?? 'Regular Season') === scope.seasonType
		&& Object.entries(filters).every(([key, value]) => ['season', 'seasonType'].includes(key) || value === null || value === undefined)
		&& (!Array.isArray(subject.ids) || subject.ids.length === 0) && (!Array.isArray(subject.names) || subject.names.length === 0);
}

function isUnfilteredEndpointRanking(request: Record<string, unknown>, metric: string, scope: RankingScope): boolean {
	if (!isRecord(request.params)) return false;
	const endpointId = String(request.endpointId);
	try {
		const actual = normalizeEndpointParams(endpointId, request.params as Record<string, string>);
		const expected = normalizeEndpointParams(endpointId, { Season: scope.season, SeasonType: scope.seasonType, PerMode: 'PerGame', ...(endpointId === 'leagueleaders' ? { StatCategory: metric.toUpperCase() } : {}) });
		return [...new Set([...Object.keys(actual), ...Object.keys(expected)])].every((key) => actual[key] === expected[key]);
	} catch {
		return false;
	}
}

/** The aggregate engine orders the full source before capping selected rows; metadata proves that scope was retained. */
function isCompleteOrderedSelection(request: Record<string, unknown>, data: Record<string, unknown>, metric: string, count: number): boolean {
	const order = isRecord(request.orderBy) ? request.orderBy : null;
	const resolvedOrder = isRecord(data.orderBy) ? data.orderBy : null;
	return String(order?.column).toLowerCase() === metric.toLowerCase() && order?.direction === 'desc'
		&& String(resolvedOrder?.column).toLowerCase() === metric.toLowerCase() && resolvedOrder?.direction === 'desc'
		&& (!Array.isArray(request.filters) || request.filters.length === 0)
		&& (!Array.isArray(request.groupBy) || request.groupBy.length === 0)
		&& typeof request.rowLimit === 'number' && request.rowLimit >= count
		&& typeof data.totalRows === 'number' && data.totalRows >= count && data.matchedRows === data.totalRows
		&& Array.isArray(data.selectedRows) && data.selectedRows.length >= count;
}

// --- End source row helpers ---
