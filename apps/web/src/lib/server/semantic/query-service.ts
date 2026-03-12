import type { DataFreshnessMode, TraceSourceCall } from '$lib/contracts/chat';
import type {
	SemanticQuery,
	SemanticQueryRequest,
	StatsQueryErrorResponse,
	StatsQueryResponse,
	StatsQueryResult,
	StatsQueryStatus,
	StatsQueryWarning
} from '$lib/contracts/semantic-query';
import type { QueryIntent } from '$lib/contracts/query-plan';
import { buildQueryPlan, normalizeQuestion as normalizeLegacyQuestion, validateQueryPlan } from '$lib/server/planner/query-plan';
import { getMetricById } from '$lib/server/metrics/registry';
import { validateMetricsForIntent } from '$lib/server/metrics/resolve-metrics';
import {
	getTraceById,
	isQueryEngineInvariantError,
	recordUnsupportedLegacyTrace,
	runMockQuery
} from '$lib/server/mock/query-engine';

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

type SupportedLegacyMapping = {
	intent: Exclude<QueryIntent, 'unsupported'>;
	legacyQuestion: string;
	resultShape: StatsQueryResult['shape'];
};

type AnalysisResult =
	| { type: 'supported'; mapping: SupportedLegacyMapping }
	| { type: 'clarification_needed' | 'coverage_gap'; warning: StatsQueryWarning; traceQuestion: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null | undefined {
	return value === undefined || value === null || typeof value === 'string';
}

function parseStringArray(value: unknown, fieldName: string): ValidationResult<string[]> {
	if (value === undefined) {
		return { ok: true, value: [] };
	}

	if (!Array.isArray(value)) {
		return { ok: false, error: `${fieldName} must be an array of strings when provided.` };
	}

	const values = value.map((item) => (typeof item === 'string' ? item.trim() : ''));
	if (values.some((item) => item.length === 0)) {
		return { ok: false, error: `${fieldName} must contain only non-empty strings.` };
	}

	return { ok: true, value: values };
}

function normalizeSubject(input: unknown): ValidationResult<SemanticQuery['subject']> {
	if (!isPlainObject(input)) {
		return { ok: false, error: 'query.subject must be an object.' };
	}

	const names = parseStringArray(input.names, 'query.subject.names');
	if (!names.ok) {
		return names;
	}

	const ids = parseStringArray(input.ids, 'query.subject.ids');
	if (!ids.ok) {
		return ids;
	}

	return {
		ok: true,
		value: {
			names: names.value,
			ids: ids.value
		}
	};
}

function normalizeMetrics(input: unknown): ValidationResult<string[]> {
	if (!Array.isArray(input)) {
		return { ok: false, error: 'query.metrics must be an array of strings.' };
	}

	const metrics = input.map((metric) => (typeof metric === 'string' ? metric.trim().toLowerCase() : ''));
	if (metrics.some((metric) => metric.length === 0)) {
		return { ok: false, error: 'query.metrics must contain only non-empty strings.' };
	}

	return { ok: true, value: metrics };
}

function normalizeFilters(input: unknown): ValidationResult<SemanticQuery['filters']> {
	if (!isPlainObject(input)) {
		return { ok: false, error: 'query.filters must be an object.' };
	}

	if (!isNullableString(input.season)) {
		return { ok: false, error: 'query.filters.season must be a string when provided.' };
	}

	if (!isNullableString(input.seasonType)) {
		return { ok: false, error: 'query.filters.seasonType must be a string when provided.' };
	}

	if (!isNullableString(input.dateFrom)) {
		return { ok: false, error: 'query.filters.dateFrom must be a string when provided.' };
	}

	if (!isNullableString(input.dateTo)) {
		return { ok: false, error: 'query.filters.dateTo must be a string when provided.' };
	}

	let window: SemanticQuery['filters']['window'] = null;
	if (input.window !== undefined && input.window !== null) {
		if (!isPlainObject(input.window)) {
			return { ok: false, error: 'query.filters.window must be an object when provided.' };
		}

		if (input.window.type !== 'last_n_games') {
			return { ok: false, error: "query.filters.window.type must be 'last_n_games'." };
		}

		const windowSize = typeof input.window.n === 'number' ? input.window.n : Number.NaN;
		if (!Number.isInteger(windowSize) || windowSize < 1) {
			return { ok: false, error: 'query.filters.window.n must be a positive integer.' };
		}

		window = {
			type: 'last_n_games',
			n: windowSize
		};
	}

	const season = typeof input.season === 'string' && input.season.trim().length > 0 ? input.season.trim() : null;
	if (season && !/^\d{4}-\d{2}$/.test(season)) {
		return { ok: false, error: "query.filters.season must match format 'YYYY-YY'." };
	}

	return {
		ok: true,
		value: {
			season,
			seasonType: typeof input.seasonType === 'string' && input.seasonType.trim().length > 0 ? input.seasonType.trim() : null,
			window,
			dateFrom: typeof input.dateFrom === 'string' && input.dateFrom.trim().length > 0 ? input.dateFrom.trim() : null,
			dateTo: typeof input.dateTo === 'string' && input.dateTo.trim().length > 0 ? input.dateTo.trim() : null
		}
	};
}

function normalizeOrderBy(input: unknown): ValidationResult<SemanticQuery['orderBy']> {
	if (input === undefined || input === null) {
		return { ok: true, value: null };
	}

	if (!isPlainObject(input)) {
		return { ok: false, error: 'query.orderBy must be an object when provided.' };
	}

	const metric = typeof input.metric === 'string' ? input.metric.trim().toLowerCase() : '';
	if (!metric) {
		return { ok: false, error: 'query.orderBy.metric is required when orderBy is provided.' };
	}

	if (input.direction !== 'asc' && input.direction !== 'desc') {
		return { ok: false, error: "query.orderBy.direction must be 'asc' or 'desc'." };
	}

	return {
		ok: true,
		value: {
			metric,
			direction: input.direction
		}
	};
}

function normalizeOutputMode(input: unknown): ValidationResult<SemanticQuery['outputMode']> {
	if (input === undefined || input === null) {
		return { ok: true, value: null };
	}

	if (input !== 'table' && input !== 'summary' && input !== 'timeseries' && input !== 'comparison') {
		return { ok: false, error: "query.outputMode must be one of 'table', 'summary', 'timeseries', or 'comparison'." };
	}

	return { ok: true, value: input };
}

function normalizeLimit(input: unknown): ValidationResult<number | null> {
	if (input === undefined || input === null) {
		return { ok: true, value: null };
	}

	const limit = typeof input === 'number' ? input : Number.NaN;
	if (!Number.isInteger(limit) || limit < 1) {
		return { ok: false, error: 'query.limit must be a positive integer when provided.' };
	}

	return { ok: true, value: limit };
}

function normalizeOptions(input: unknown): ValidationResult<SemanticQueryRequest['options']> {
	if (input === undefined) {
		return { ok: true, value: undefined };
	}

	if (!isPlainObject(input)) {
		return { ok: false, error: 'options must be an object when provided.' };
	}

	if (input.allowLiveFallback !== undefined && typeof input.allowLiveFallback !== 'boolean') {
		return { ok: false, error: 'options.allowLiveFallback must be a boolean when provided.' };
	}

	return {
		ok: true,
		value: {
			allowLiveFallback: typeof input.allowLiveFallback === 'boolean' ? input.allowLiveFallback : undefined
		}
	};
}

function legacyTraceProvenance(
	traceId: string,
	normalizedQuestion: string,
	legacyIntent: QueryIntent | null,
	dataFreshnessMode: DataFreshnessMode = 'nightly',
	sourceCalls: TraceSourceCall[] = []
): StatsQueryResponse['provenance'] {
	return {
		executor: 'legacy_adapter',
		legacyIntent,
		normalizedQuestion,
		dataFreshnessMode,
		sourceCalls
	};
}

function buildWarning(code: string, message: string): StatsQueryWarning {
	return { code, message };
}

function firstMetric(query: SemanticQuery): string | null {
	return query.metrics[0] ?? null;
}

function subjectNames(query: SemanticQuery): string[] {
	return query.subject.names ?? [];
}

function formatMetric(metricId: string): string {
	const definition = getMetricById(metricId);
	if (!definition) {
		return metricId.toUpperCase();
	}

	return definition.aliases[0] ?? metricId.toUpperCase();
}

function formatSeason(query: SemanticQuery): string {
	return query.filters.season ?? 'this season';
}

function buildTraceQuestion(query: SemanticQuery): string {
	const names = subjectNames(query);
	const metricId = firstMetric(query) ?? 'unknown metric';

	if (query.operation === 'compare') {
		return `Compare ${names.join(' vs ')} by ${metricId}`;
	}

	if (query.operation === 'trend') {
		return `Show ${names[0] ?? 'the player'} ${metricId} trend`;
	}

	if (query.operation === 'rank' && query.entity === 'team') {
		return `Rank teams by ${metricId}`;
	}

	return `${query.operation} ${query.entity} for ${metricId}`;
}

function buildCoverageResponse(
	status: Exclude<StatsQueryStatus, 'ok'>,
	query: SemanticQuery,
	warning: StatsQueryWarning,
	traceQuestion: string
): StatsQueryResponse {
	const trace = recordUnsupportedLegacyTrace(traceQuestion, [warning.message]);

	return {
		status,
		result: null,
		citations: [],
		provenance: legacyTraceProvenance(trace.traceId, trace.normalizedQuestion, trace.queryPlan.intent),
		warnings: [warning],
		traceId: trace.traceId
	};
}

function inferResultShape(query: SemanticQuery, legacyIntent: QueryIntent): StatsQueryResult['shape'] {
	if (query.outputMode === 'timeseries' || legacyIntent === 'player_trend') {
		return 'timeseries';
	}

	if (query.outputMode === 'comparison' || legacyIntent === 'player_compare') {
		return 'comparison';
	}

	if (legacyIntent === 'league_leaders' || legacyIntent === 'team_ranking') {
		return 'ranking';
	}

	return 'table';
}

function inferColumns(shape: StatsQueryResult['shape']): string[] {
	if (shape === 'timeseries') {
		return ['label', 'value'];
	}

	if (shape === 'comparison') {
		return ['subject', 'metric', 'value'];
	}

	if (shape === 'ranking') {
		return ['rank', 'subject', 'metric', 'value'];
	}

	return ['subject', 'metric', 'value'];
}

function buildStructuredResult(query: SemanticQuery, summary: string, legacyIntent: QueryIntent): StatsQueryResult {
	const shape = inferResultShape(query, legacyIntent);
	return {
		shape,
		columns: inferColumns(shape),
		rows: [],
		summary
	};
}

function buildRankPlayerQuestion(query: SemanticQuery, metricId: string): string {
	return `Who averaged the most ${formatMetric(metricId)} in ${formatSeason(query)}?`;
}

function buildTrendQuestion(query: SemanticQuery, metricId: string): string {
	const player = subjectNames(query)[0];
	const season = query.filters.season ? ` in ${query.filters.season}` : '';

	if (query.filters.window) {
		return `Show ${player} ${formatMetric(metricId)} over his last ${query.filters.window.n} games${season}`;
	}

	return `Show ${player} ${formatMetric(metricId)} trend${season}`;
}

function buildCompareQuestion(query: SemanticQuery, metricId: string): string {
	const [left, right] = subjectNames(query);
	const season = query.filters.season ? ` in ${query.filters.season}` : ' this season';
	return `Compare ${left} vs ${right} by ${formatMetric(metricId)}${season}`;
}

function buildTeamRankingQuestion(query: SemanticQuery): string {
	const season = query.filters.season ? ` in ${query.filters.season}` : ' this season';
	return `Which teams have the best defensive rating${season}?`;
}

function analyzeQuery(query: SemanticQuery): AnalysisResult {
	const metricId = firstMetric(query);
	const names = subjectNames(query);

	if (query.operation === 'compare') {
		if (query.entity !== 'player') {
			return {
				type: 'coverage_gap',
				warning: buildWarning('unsupported_compare_scope', 'Milestone 1 only supports player-to-player comparisons.'),
				traceQuestion: buildTraceQuestion(query)
			};
		}

		if (names.length !== 2) {
			return {
				type: 'clarification_needed',
				warning: buildWarning('compare_requires_two_subjects', 'Player comparisons require exactly two player names in milestone 1.'),
				traceQuestion: buildTraceQuestion(query)
			};
		}

		if (!metricId) {
			return {
				type: 'clarification_needed',
				warning: buildWarning('metric_required', 'A metric is required for player comparison queries.'),
				traceQuestion: buildTraceQuestion(query)
			};
		}

		const metricValidation = validateMetricsForIntent('player_compare', [{ id: metricId, confidence: 1 }]);
		if (!metricValidation.ok) {
			return {
				type: 'coverage_gap',
				warning: buildWarning('unsupported_metric', metricValidation.error),
				traceQuestion: buildTraceQuestion(query)
			};
		}

		return {
			type: 'supported',
			mapping: {
				intent: 'player_compare',
				legacyQuestion: buildCompareQuestion(query, metricId),
				resultShape: 'comparison'
			}
		};
	}

	if (query.operation === 'trend') {
		if (query.entity !== 'player') {
			return {
				type: 'coverage_gap',
				warning: buildWarning('unsupported_trend_scope', 'Milestone 1 only supports player trend queries.'),
				traceQuestion: buildTraceQuestion(query)
			};
		}

		if (names.length !== 1) {
			return {
				type: 'clarification_needed',
				warning: buildWarning('trend_requires_subject', 'Player trend queries require exactly one player name in milestone 1.'),
				traceQuestion: buildTraceQuestion(query)
			};
		}

		if (!metricId) {
			return {
				type: 'clarification_needed',
				warning: buildWarning('metric_required', 'A metric is required for player trend queries.'),
				traceQuestion: buildTraceQuestion(query)
			};
		}

		const metricValidation = validateMetricsForIntent('player_trend', [{ id: metricId, confidence: 1 }]);
		if (!metricValidation.ok) {
			return {
				type: 'coverage_gap',
				warning: buildWarning('unsupported_metric', metricValidation.error),
				traceQuestion: buildTraceQuestion(query)
			};
		}

		return {
			type: 'supported',
			mapping: {
				intent: 'player_trend',
				legacyQuestion: buildTrendQuestion(query, metricId),
				resultShape: 'timeseries'
			}
		};
	}

	if (query.operation === 'rank' && query.entity === 'player') {
		if (!metricId) {
			return {
				type: 'clarification_needed',
				warning: buildWarning('metric_required', 'A metric is required for player ranking queries.'),
				traceQuestion: buildTraceQuestion(query)
			};
		}

		if (names.length > 0) {
			return {
				type: 'coverage_gap',
				warning: buildWarning('unsupported_subject_filter', 'Milestone 1 player rankings only support league-wide leader queries.'),
				traceQuestion: buildTraceQuestion(query)
			};
		}

		const metricValidation = validateMetricsForIntent('league_leaders', [{ id: metricId, confidence: 1 }]);
		if (!metricValidation.ok) {
			return {
				type: 'coverage_gap',
				warning: buildWarning('unsupported_metric', metricValidation.error),
				traceQuestion: buildTraceQuestion(query)
			};
		}

		return {
			type: 'supported',
			mapping: {
				intent: 'league_leaders',
				legacyQuestion: buildRankPlayerQuestion(query, metricId),
				resultShape: 'ranking'
			}
		};
	}

	if (query.operation === 'rank' && query.entity === 'team') {
		if (!metricId) {
			return {
				type: 'clarification_needed',
				warning: buildWarning('metric_required', 'A metric is required for team ranking queries.'),
				traceQuestion: buildTraceQuestion(query)
			};
		}

		const metricValidation = validateMetricsForIntent('team_ranking', [{ id: metricId, confidence: 1 }]);
		if (!metricValidation.ok) {
			return {
				type: 'coverage_gap',
				warning: buildWarning('unsupported_metric', metricValidation.error),
				traceQuestion: buildTraceQuestion(query)
			};
		}

		return {
			type: 'supported',
			mapping: {
				intent: 'team_ranking',
				legacyQuestion: buildTeamRankingQuestion(query),
				resultShape: 'ranking'
			}
		};
	}

	return {
		type: 'coverage_gap',
		warning: buildWarning(
			'unsupported_query_shape',
			'Milestone 1 only supports player rankings, player trends, player comparisons, and team defensive rankings.'
		),
		traceQuestion: buildTraceQuestion(query)
	};
}

/**
 * Validates the public structured contract so the core lookup tool stays deterministic for the caller.
 */
export function validateSemanticQueryRequest(input: unknown): ValidationResult<SemanticQueryRequest> {
	if (!isPlainObject(input)) {
		return { ok: false, error: 'Request body must be a JSON object.' };
	}

	if (input.question !== undefined && typeof input.question !== 'string') {
		return { ok: false, error: 'question must be a string when provided.' };
	}

	if (!isPlainObject(input.query)) {
		return { ok: false, error: 'query is required.' };
	}

	const operation = input.query.operation;
	if (
		operation !== 'lookup' &&
		operation !== 'rank' &&
		operation !== 'compare' &&
		operation !== 'trend' &&
		operation !== 'split' &&
		operation !== 'game' &&
		operation !== 'event'
	) {
		return { ok: false, error: 'query.operation is required and must be a supported semantic operation.' };
	}

	const entity = input.query.entity;
	if (entity !== 'player' && entity !== 'team' && entity !== 'game' && entity !== 'event' && entity !== 'league') {
		return { ok: false, error: 'query.entity is required and must be a supported semantic entity.' };
	}

	const subject = normalizeSubject(input.query.subject);
	if (!subject.ok) {
		return subject;
	}

	const metrics = normalizeMetrics(input.query.metrics);
	if (!metrics.ok) {
		return metrics;
	}

	const filters = normalizeFilters(input.query.filters ?? {});
	if (!filters.ok) {
		return filters;
	}

	const orderBy = normalizeOrderBy(input.query.orderBy);
	if (!orderBy.ok) {
		return orderBy;
	}

	const outputMode = normalizeOutputMode(input.query.outputMode);
	if (!outputMode.ok) {
		return outputMode;
	}

	const limit = normalizeLimit(input.query.limit);
	if (!limit.ok) {
		return limit;
	}

	const options = normalizeOptions(input.options);
	if (!options.ok) {
		return options;
	}

	return {
		ok: true,
		value: {
			question: typeof input.question === 'string' && input.question.trim().length > 0 ? input.question.trim() : undefined,
			query: {
				operation,
				entity,
				subject: subject.value,
				metrics: metrics.value,
				filters: filters.value,
				orderBy: orderBy.value,
				limit: limit.value,
				outputMode: outputMode.value
			},
			options: options.value
		}
	};
}

/**
 * Runs the new semantic contract through the legacy executor until the canonical warehouse executor exists.
 */
export async function executeSemanticQuery(request: SemanticQueryRequest): Promise<StatsQueryResponse> {
	const analysis = analyzeQuery(request.query);
	if (analysis.type !== 'supported') {
		return buildCoverageResponse(analysis.type, request.query, analysis.warning, request.question ?? analysis.traceQuestion);
	}

	const normalizedQuestion = normalizeLegacyQuestion(analysis.mapping.legacyQuestion);
	const legacyPlan = buildQueryPlan(normalizedQuestion);
	const legacyValidation = validateQueryPlan(legacyPlan);

	if (!legacyValidation.ok || legacyPlan.intent !== analysis.mapping.intent) {
		return buildCoverageResponse(
			'coverage_gap',
			request.query,
			buildWarning(
				'legacy_mapping_mismatch',
				'The semantic query could not be translated into the current legacy execution slice.'
			),
			request.question ?? analysis.mapping.legacyQuestion
		);
	}

	try {
		const legacyResponse = await runMockQuery({
			sessionId: 'semantic-route',
			message: analysis.mapping.legacyQuestion
		});
		const trace = getTraceById(legacyResponse.traceId);

		if (!trace) {
			throw new Error('Missing legacy trace for semantic execution.');
		}

		return {
			status: 'ok',
			result: buildStructuredResult(request.query, legacyResponse.answer, trace.queryPlan.intent),
			citations: legacyResponse.citations,
			provenance: legacyTraceProvenance(
				trace.traceId,
				trace.normalizedQuestion,
				trace.queryPlan.intent,
				trace.dataFreshnessMode,
				trace.sourceCalls
			),
			warnings: [],
			traceId: legacyResponse.traceId
		};
	} catch (error) {
		if (isQueryEngineInvariantError(error)) {
			return buildCoverageResponse(
				'coverage_gap',
				request.query,
				buildWarning('legacy_invariant_filtered', 'The translated legacy query is outside the currently safe execution slice.'),
				request.question ?? analysis.mapping.legacyQuestion
			);
		}

		throw error;
	}
}
