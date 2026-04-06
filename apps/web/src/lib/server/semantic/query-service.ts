import type {
	ChatQueryRequest,
	Citation,
	DataFreshnessMode,
	TraceSourceCall
} from '$lib/contracts/chat';
import type { QueryTraceResponse, SemanticQueryTraceResponse } from '$lib/contracts/query-trace';
import type {
	SemanticQuery,
	SemanticQueryFilters,
	SemanticQueryRequest,
	StatsQueryResponse,
	StatsQueryResult,
	StatsQueryStatus,
	StatsQueryWarning
} from '$lib/contracts/semantic-query';
import { fetchStatsEndpointWithCache, type EndpointFetchRequest, type EndpointFetchResult } from '$lib/server/data/adapters';
import { getEndpointCatalogEntry } from '$lib/server/data';
import { normalizeMetricQuery, resolveMetrics, validateMetricsForIntent } from '$lib/server/metrics/resolve-metrics';
import {
	buildLeagueStandingsRequest,
	buildLeagueWidePlayerRankingRequest,
	buildLeagueWideTeamDefenseRequest
} from '$lib/server/nightly/current-season';
import {
	extractPlayerDirectoryExactNameMentions,
	ensurePlayerDirectoryAvailable,
	findPlayerDirectoryEntriesByNameOrAlias,
	findPlayerDirectoryEntryById,
	hasStoredPlayerDirectorySnapshot,
	validateStructuredPlayerSubjectPairs
} from '$lib/server/players/player-directory';
import {
	findTeamDirectoryEntriesByNameOrAlias,
	findTeamDirectoryEntryById,
	validateStructuredTeamSubjectPairs
} from '$lib/server/teams/team-directory';
import {
	extractPlayerLookupRow,
	extractPlayerComparisonRows,
	extractPlayerRankingRows,
	extractPlayerTrendRows,
	extractTeamLookupRow,
	extractTeamRankingRows,
	extractTeamStandingsRankingRows,
	extractTeamStandingsRow,
	SemanticExtractionError
} from './extractors';
import {
	buildMissingTeamGameWarning,
	buildTeamGameRequests,
	createTeamGamePlan,
	extractTeamGameResult,
	type TeamGamePlan
} from './team-game';
import { getDefaultMetricSortDirection, validateSemanticCapabilityQueryShape } from './capabilities';
import { saveSemanticTrace } from './trace-store';

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

type WarningResult = {
	type: 'clarification_needed' | 'coverage_gap';
	warning: StatsQueryWarning;
	resolvedQuery: SemanticQuery | null;
};

type ResolvedPlayerSubject = {
	id: string;
	name: string;
};

type ResolvedTeamSubject = {
	id: string;
	name: string;
};

type RankingPlan = {
	type: 'player_ranking';
	query: SemanticQuery;
	season: string;
	limit: number;
};

type LookupPlan = {
	type: 'player_lookup';
	query: SemanticQuery;
	subject: ResolvedPlayerSubject;
	season: string;
};

type TeamLookupPlan = {
	type: 'team_lookup';
	query: SemanticQuery;
	subject: ResolvedTeamSubject;
	season: string;
};

type TrendPlan = {
	type: 'player_trend';
	query: SemanticQuery;
	subject: ResolvedPlayerSubject;
	season: string;
	sampleLimit: number | null;
};

type ComparisonPlan = {
	type: 'player_comparison';
	query: SemanticQuery;
	subjects: ResolvedPlayerSubject[];
	season: string;
};

type TeamRankingPlan = {
	type: 'team_ranking';
	query: SemanticQuery;
	season: string;
	limit: number;
	subject: ResolvedTeamSubject | null;
};

type TeamStandingsPlan = {
	type: 'team_standings';
	query: SemanticQuery;
	season: string;
	limit: number;
	subject: ResolvedTeamSubject | null;
};

type ExecutionPlan = LookupPlan | TeamLookupPlan | RankingPlan | TrendPlan | ComparisonPlan | TeamRankingPlan | TeamStandingsPlan | TeamGamePlan;

type RetrievalOutcome = {
	sourceCalls: TraceSourceCall[];
	citations: Citation[];
	cache: QueryTraceResponse['cache'];
	dataFreshnessMode: DataFreshnessMode;
	retrievalLatencyMs: number;
	responses: Array<{ request: EndpointFetchRequest; result: EndpointFetchResult }>;
};

const COMPARE_KEYWORDS = ['compare', 'vs', 'versus'];
const LEADER_KEYWORDS = ['leader', 'leaders', 'most', 'highest', 'top'];
const TREND_KEYWORDS = ['trend', 'trending'];
const TEAM_RANKING_KEYWORDS = ['rank', 'ranking', 'best', 'worst'];
const TEAM_TERMS = ['team', 'teams'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null | undefined {
	return value === undefined || value === null || typeof value === 'string';
}

function isWarningResult(value: WarningResult | ExecutionPlan | SemanticQueryRequest): value is WarningResult {
	return typeof value === 'object' && value !== null && 'warning' in value;
}

function parseStringArray(value: unknown, fieldName: string): ValidationResult<string[]> {
	if (value === undefined) {
		return { ok: true, value: [] };
	}

	if (!Array.isArray(value)) {
		return { ok: false, error: `${fieldName} must be an array of strings when provided.` };
	}

	const values = Array.from(
		new Set(value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => item.length > 0))
	);
	if (Array.isArray(value) && values.length !== value.length) {
		const hasInvalid = value.some((item) => typeof item !== 'string' || item.trim().length === 0);
		if (hasInvalid) {
			return { ok: false, error: `${fieldName} must contain only non-empty strings.` };
		}
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

	const metrics = Array.from(
		new Set(input.map((metric) => (typeof metric === 'string' ? metric.trim().toLowerCase() : '')).filter(Boolean))
	);
	if (metrics.length !== input.length) {
		const hasInvalid = input.some((metric) => typeof metric !== 'string' || metric.trim().length === 0);
		if (hasInvalid) {
			return { ok: false, error: 'query.metrics must contain only non-empty strings.' };
		}
	}

	return { ok: true, value: metrics };
}

function normalizeFilters(input: unknown): ValidationResult<SemanticQueryFilters> {
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

	if (!isNullableString(input.conference)) {
		return { ok: false, error: 'query.filters.conference must be a string when provided.' };
	}

	if (!isNullableString(input.division)) {
		return { ok: false, error: 'query.filters.division must be a string when provided.' };
	}

	if (!isNullableString(input.gameStatus)) {
		return { ok: false, error: 'query.filters.gameStatus must be a string when provided.' };
	}

	let window: SemanticQueryFilters['window'] = null;
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
			dateTo: typeof input.dateTo === 'string' && input.dateTo.trim().length > 0 ? input.dateTo.trim() : null,
			conference:
				typeof input.conference === 'string' && input.conference.trim().length > 0
					? (input.conference.trim() as SemanticQueryFilters['conference'])
					: null,
			division:
				typeof input.division === 'string' && input.division.trim().length > 0
					? (input.division.trim() as SemanticQueryFilters['division'])
					: null,
			gameStatus:
				typeof input.gameStatus === 'string' && input.gameStatus.trim().length > 0
					? (input.gameStatus.trim() as SemanticQueryFilters['gameStatus'])
					: null
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

function normalizeOptions(input: unknown): ValidationResult<Record<string, never> | undefined> {
	if (input === undefined) {
		return { ok: true, value: undefined };
	}

	if (!isPlainObject(input)) {
		return { ok: false, error: 'options must be an object when provided.' };
	}

	if (input.allowLiveFallback !== undefined) {
		return { ok: false, error: 'options.allowLiveFallback has been removed. Semantic queries now use stored nightly data only.' };
	}

	if (Object.keys(input).length > 0) {
		return { ok: false, error: 'options does not currently accept any fields.' };
	}

	return { ok: true, value: {} };
}

function buildWarning(code: string, message: string): StatsQueryWarning {
	return { code, message };
}

function buildLatency(input: Omit<QueryTraceResponse['latencyMs'], 'total'>): QueryTraceResponse['latencyMs'] {
	return {
		...input,
		total: input.planning + input.retrieval + input.compute + input.render
	};
}

function resolveCurrentSeason(now: Date = new Date()): string {
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth() + 1;
	const startYear = month >= 10 ? year : year - 1;
	const endYear = (startYear + 1).toString().slice(-2);
	return `${startYear}-${endYear}`;
}

function normalizeQuestion(message: string): string {
	return normalizeMetricQuery(message);
}

function includesKeyword(normalizedQuestion: string, keyword: string): boolean {
	if (keyword.includes(' ')) {
		return normalizedQuestion.includes(keyword);
	}
	return normalizedQuestion.split(' ').includes(keyword);
}

function includesAny(normalizedQuestion: string, values: string[]): boolean {
	return values.some((value) => includesKeyword(normalizedQuestion, value));
}

function extractWindowFilter(normalizedQuestion: string): SemanticQueryFilters['window'] {
	const explicitWindow = normalizedQuestion.match(/\blast\s+(\d{1,2})\s+games?\b/);
	if (explicitWindow) {
		const n = Number.parseInt(explicitWindow[1], 10);
		if (Number.isInteger(n) && n > 0) {
			return { type: 'last_n_games', n };
		}
	}

	const shortWindow = normalizedQuestion.match(/\blast\s+(\d{1,2})\b/);
	if (shortWindow) {
		const n = Number.parseInt(shortWindow[1], 10);
		if (Number.isInteger(n) && n > 0) {
			return { type: 'last_n_games', n };
		}
	}

	return null;
}

function extractSeason(normalizedQuestion: string): string | null {
	const match = normalizedQuestion.match(/\b(?:19|20)\d{2}-\d{2}\b/);
	return match ? match[0] : null;
}

function extractPlayers(normalizedQuestion: string): string[] {
	return extractPlayerDirectoryExactNameMentions(normalizedQuestion);
}

function buildTraceQuestion(query: SemanticQuery): string {
	const names = query.subject.names ?? [];
	const metricId = query.metrics[0] ?? 'unknown metric';

	if (query.operation === 'lookup') {
		return `Lookup ${names[0] ?? 'the player'} for ${query.metrics.join(', ') || metricId}`;
	}

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

function sourceCallFromResult(result: EndpointFetchResult): TraceSourceCall {
	return {
		endpointId: result.endpointId,
		cacheStatus: result.cacheStatus,
		latencyMs: result.latencyMs,
		stale: result.stale,
		isProvisional: result.isProvisional,
		parserVersion: result.parserVersion,
		sourceStatus: result.sourceStatus
	};
}

function buildCitationFromResult(result: EndpointFetchResult): Citation {
	const detailParts = [`cache=${result.cacheStatus}`];
	if (result.stale) {
		detailParts.push('stale');
	}
	if (result.sourceStatus !== 'ok') {
		detailParts.push(`source_status=${result.sourceStatus}`);
	}
	if (result.errorDetail) {
		detailParts.push(result.errorDetail);
	}

	return {
		source: `NBA stats endpoint: ${result.endpointId}`,
		detail: detailParts.join('; ')
	};
}

function buildFallbackSourceCalls(endpointIds: string[]): TraceSourceCall[] {
	return endpointIds.map((endpointId) => {
		const catalog = getEndpointCatalogEntry(endpointId);
		return {
			endpointId,
			cacheStatus: 'miss',
			latencyMs: 0,
			stale: false,
			isProvisional: false,
			parserVersion: catalog?.parserVersion ?? 'v1',
			sourceStatus: 'error'
		};
	});
}

async function executeEndpointRequests(
	requests: EndpointFetchRequest[]
): Promise<RetrievalOutcome> {
	const sourceCalls: TraceSourceCall[] = [];
	const citations: Citation[] = [];
	const responses: RetrievalOutcome['responses'] = [];

	if (requests.length === 0) {
		return {
			sourceCalls: [],
			citations: [],
			cache: { hits: 0, misses: 0 },
			dataFreshnessMode: 'nightly',
			retrievalLatencyMs: 0,
			responses
		};
	}

	let retrievalLatencyMs = 0;

	for (const request of requests) {
		let result: EndpointFetchResult;
		try {
			result = await fetchStatsEndpointWithCache({
				...request,
				allowLiveFetch: false
			});
		} catch (error) {
			const fallback = buildFallbackSourceCalls([request.endpointId])[0];
			result = {
				endpointId: request.endpointId,
				payload: null,
				cacheStatus: fallback.cacheStatus,
				sourceStatus: 'error',
				latencyMs: 0,
				stale: false,
				isProvisional: false,
				parserVersion: fallback.parserVersion,
				errorDetail: String(error)
			};
		}

		retrievalLatencyMs += result.latencyMs;
		sourceCalls.push(sourceCallFromResult(result));
		citations.push(buildCitationFromResult(result));
		responses.push({ request, result });
	}

	const hits = sourceCalls.filter((sourceCall) => sourceCall.cacheStatus === 'hit' || sourceCall.cacheStatus === 'stale_hit').length;
	const misses = sourceCalls.filter((sourceCall) => sourceCall.cacheStatus === 'miss').length;
	const dataFreshnessMode: DataFreshnessMode = sourceCalls.some((sourceCall) => sourceCall.isProvisional)
		? 'provisional_live'
		: 'nightly';

	return {
		sourceCalls,
		citations,
		cache: { hits, misses },
		dataFreshnessMode,
		retrievalLatencyMs,
		responses
	};
}

function validateMetricSet(
	intent: 'player_lookup' | 'team_lookup' | 'league_leaders' | 'player_trend' | 'player_compare' | 'team_ranking',
	metrics: string[]
): WarningResult | null {
	const validation = validateMetricsForIntent(
		intent,
		metrics.map((metric) => ({ id: metric, confidence: 1 }))
	);
	if (validation.ok) {
		return null;
	}

	return {
		type: 'coverage_gap',
		warning: buildWarning('unsupported_metric', validation.error),
		resolvedQuery: null
	};
}

/* Helper functions */

type PlayerSubjectResolutionResult =
	| {
			ok: true;
			value: Array<
				ResolvedPlayerSubject & {
					ambiguityError?: string | null;
				}
			>;
	  }
	| {
			ok: false;
			code: 'player_directory_unavailable' | 'subject_resolution_error' | 'ambiguous_subject';
			error: string;
	  };

function resolvePlayerSubjects(
	subject: SemanticQuery['subject']
): PlayerSubjectResolutionResult {
	const names = subject.names ?? [];
	const ids = subject.ids ?? [];

	if (ids.length > 0 && names.length > 0 && ids.length !== names.length) {
		return {
			ok: false,
			code: 'subject_resolution_error',
			error: 'query.subject.ids and query.subject.names must have matching lengths when both are provided.'
		};
	}

	const directoryAvailability = ensurePlayerDirectoryAvailable();
	if (!directoryAvailability.ok) {
		return {
			ok: false,
			code: 'player_directory_unavailable',
			error: directoryAvailability.message
		};
	}

	if (ids.length > 0) {
		return {
			ok: true,
			value: ids.map((id, index) => {
				const player = findPlayerDirectoryEntryById(id);
				return {
					id: player?.playerId ?? '',
					name: player?.canonicalName ?? names[index] ?? id
				};
			})
		};
	}

	return {
		ok: true,
		value: names.map((name) => {
			const matches = findPlayerDirectoryEntriesByNameOrAlias(name);
			if (matches.length > 1) {
				return {
					id: '',
					name: '',
					ambiguityError: `Alias "${name}" is ambiguous. Matches: ${matches
						.map((match) => match.canonicalName)
						.join(', ')}.`
				};
			}

			const player = matches[0];
			return {
				id: player?.playerId ?? '',
				name: player?.canonicalName ?? name,
				ambiguityError: null
			};
		})
	};
}

function resolvePlayerEntity(
	subject: SemanticQuery['subject'],
	expectedCount: number | null
): ResolvedPlayerSubject[] | WarningResult {
	const resolved = resolvePlayerSubjects(subject);
	if (!resolved.ok) {
		return {
			type: resolved.code === 'player_directory_unavailable' ? 'coverage_gap' : 'clarification_needed',
			warning: buildWarning(resolved.code, resolved.error),
			resolvedQuery: null
		};
	}

	if (expectedCount !== null && resolved.value.length !== expectedCount) {
		return {
			type: 'clarification_needed',
			warning: buildWarning(
				expectedCount === 1 ? 'trend_requires_subject' : 'compare_requires_two_subjects',
				expectedCount === 1
					? 'Player trend queries require exactly one player name in this slice.'
					: 'Player comparisons require exactly two player names in this slice.'
			),
			resolvedQuery: null
		};
	}

	const ambiguous = resolved.value.find(
		(player) => 'ambiguityError' in player && typeof player.ambiguityError === 'string' && player.ambiguityError.length > 0
	);
	if (ambiguous && 'ambiguityError' in ambiguous) {
		const ambiguityError =
			typeof ambiguous.ambiguityError === 'string' ? ambiguous.ambiguityError : 'Player subject is ambiguous.';
		return {
			type: 'clarification_needed',
			warning: buildWarning('ambiguous_subject', ambiguityError),
			resolvedQuery: null
		};
	}

	const missing = resolved.value.filter((player) => player.id.length === 0);
	if (missing.length > 0) {
		return {
			type: 'coverage_gap',
			warning: buildWarning(
				'unknown_subject',
				`Unable to resolve player IDs for: ${missing.map((player) => player.name).join(', ')}.`
			),
			resolvedQuery: null
		};
	}

	return resolved.value;
}

function resolveTeamEntity(subject: SemanticQuery['subject']): ResolvedTeamSubject | null | WarningResult {
	const ids = subject.ids ?? [];
	const names = subject.names ?? [];

	if (ids.length === 0 && names.length === 0) {
		return null;
	}

	if (ids.length > 1 || names.length > 1) {
		return {
			type: 'clarification_needed',
			warning: buildWarning('team_requires_single_subject', 'Team ranking queries support at most one team in this slice.'),
			resolvedQuery: null
		};
	}

	if (names.length === 1) {
		const matches = findTeamDirectoryEntriesByNameOrAlias(names[0]);
		if (matches.length > 1) {
			return {
				type: 'clarification_needed',
				warning: buildWarning(
					'ambiguous_subject',
					`Alias "${names[0]}" is ambiguous. Matches: ${matches.map((match) => match.canonicalName).join(', ')}.`
				),
				resolvedQuery: null
			};
		}

		const team = matches[0];
		if (!team) {
			return {
				type: 'coverage_gap',
				warning: buildWarning('unknown_subject', `Unable to resolve team IDs for: ${names[0]}.`),
				resolvedQuery: null
			};
		}

		return {
			id: team.teamId,
			name: team.canonicalName
		};
	}

	const team = findTeamDirectoryEntryById(ids[0]);
	if (!team) {
		return {
			type: 'coverage_gap',
			warning: buildWarning('unknown_subject', `Unable to resolve team IDs for: ${ids[0]}.`),
			resolvedQuery: null
		};
	}

	return {
		id: team.teamId,
		name: team.canonicalName
	};
}

function defaultMetricForQuery(operation: SemanticQuery['operation'], entity: SemanticQuery['entity']): string[] {
	if (operation === 'rank' && entity === 'team') {
		return ['drtg'];
	}

	return ['pts'];
}

function buildCanonicalResolvedQuery(
	query: SemanticQuery,
	now: Date,
	resolvedSubjects: ResolvedPlayerSubject[] = [],
	resolvedTeamSubject: ResolvedTeamSubject | null = null
): SemanticQuery {
	const season = query.filters.season ?? resolveCurrentSeason(now);
	const seasonType = query.filters.seasonType ?? 'Regular Season';

	return {
		...query,
		subject:
			query.entity === 'player'
				? {
						ids: resolvedSubjects.map((subject) => subject.id),
						names: resolvedSubjects.map((subject) => subject.name)
					}
				: query.entity === 'team' && resolvedTeamSubject
					? {
							ids: [resolvedTeamSubject.id],
							names: [resolvedTeamSubject.name]
						}
				: {
						names: query.subject.names ?? [],
						ids: query.subject.ids ?? []
					},
		filters: {
			...query.filters,
			season,
			seasonType
		}
	};
}

function determineSupportedPlan(
	query: SemanticQuery,
	now: Date
): ExecutionPlan | WarningResult {
	if (query.orderBy && query.operation !== 'rank') {
		return {
			type: 'coverage_gap',
			warning: buildWarning('unsupported_order_by', 'query.orderBy is only supported for ranking queries in this slice.'),
			resolvedQuery: query
		};
	}

	if (query.orderBy && !query.metrics.includes(query.orderBy.metric)) {
		return {
			type: 'coverage_gap',
			warning: buildWarning('unsupported_order_by', 'query.orderBy.metric must reference one of the requested metrics.'),
			resolvedQuery: query
		};
	}

	if (query.operation === 'lookup' && query.entity === 'player') {
		const subject = resolvePlayerEntity(query.subject, 1);
		if (!Array.isArray(subject)) {
			return subject.resolvedQuery === null ? subject : { ...subject, resolvedQuery: query };
		}

		const metricWarning = validateMetricSet('player_lookup', query.metrics);
		if (metricWarning) {
			return { ...metricWarning, resolvedQuery: query };
		}

		return {
			type: 'player_lookup',
			query: buildCanonicalResolvedQuery(query, now, subject),
			subject: subject[0],
			season: query.filters.season ?? resolveCurrentSeason(now)
		};
	}

	if (query.operation === 'lookup' && query.entity === 'team') {
		const subject = resolveTeamEntity(query.subject);
		if (subject && 'warning' in subject) {
			return subject.resolvedQuery === null ? subject : { ...subject, resolvedQuery: query };
		}
		const resolvedSubject = subject as ResolvedTeamSubject;

		const metricWarning = validateMetricSet('team_lookup', query.metrics);
		if (metricWarning) {
			return { ...metricWarning, resolvedQuery: query };
		}

		return {
			type: 'team_lookup',
			query: buildCanonicalResolvedQuery(query, now, [], resolvedSubject),
			subject: resolvedSubject,
			season: query.filters.season ?? resolveCurrentSeason(now)
		};
	}

	if (query.operation === 'rank' && query.entity === 'player') {
		if ((query.subject.names?.length ?? 0) > 0 || (query.subject.ids?.length ?? 0) > 0) {
			return {
				type: 'coverage_gap',
				warning: buildWarning('unsupported_subject_filter', 'Player rankings only support league-wide leader queries in this slice.'),
				resolvedQuery: query
			};
		}

		const metricWarning = validateMetricSet('league_leaders', query.metrics);
		if (metricWarning) {
			return { ...metricWarning, resolvedQuery: query };
		}

		return {
			type: 'player_ranking',
			query: buildCanonicalResolvedQuery(query, now),
			season: query.filters.season ?? resolveCurrentSeason(now),
			limit: query.limit ?? 10
		};
	}

	if (query.operation === 'trend' && query.entity === 'player') {
		const subject = resolvePlayerEntity(query.subject, 1);
		if (!Array.isArray(subject)) {
			return subject.resolvedQuery === null ? subject : { ...subject, resolvedQuery: query };
		}

		const metricWarning = validateMetricSet('player_trend', query.metrics);
		if (metricWarning) {
			return { ...metricWarning, resolvedQuery: query };
		}

		return {
			type: 'player_trend',
			query: buildCanonicalResolvedQuery(query, now, subject),
			subject: subject[0],
			season: query.filters.season ?? resolveCurrentSeason(now),
			sampleLimit: query.limit ?? null
		};
	}

	if (query.operation === 'compare' && query.entity === 'player') {
		const subjects = resolvePlayerEntity(query.subject, 2);
		if (!Array.isArray(subjects)) {
			return subjects.resolvedQuery === null ? subjects : { ...subjects, resolvedQuery: query };
		}

		const metricWarning = validateMetricSet('player_compare', query.metrics);
		if (metricWarning) {
			return { ...metricWarning, resolvedQuery: query };
		}

		return {
			type: 'player_comparison',
			query: buildCanonicalResolvedQuery(query, now, subjects),
			subjects,
			season: query.filters.season ?? resolveCurrentSeason(now)
		};
	}

	if (query.operation === 'rank' && query.entity === 'team') {
		const subject = resolveTeamEntity(query.subject);
		if (subject && 'warning' in subject) {
			return subject.resolvedQuery === null ? subject : { ...subject, resolvedQuery: query };
		}

		if (query.metrics.length !== 1) {
			return {
				type: 'coverage_gap',
				warning: buildWarning('unsupported_metric', 'Team rankings support only one metric in this slice.'),
				resolvedQuery: query
			};
		}

		const metricWarning = validateMetricSet('team_ranking', query.metrics);
		if (metricWarning) {
			return { ...metricWarning, resolvedQuery: query };
		}

		return {
			type: 'team_ranking',
			query: buildCanonicalResolvedQuery(query, now, [], subject),
			season: query.filters.season ?? resolveCurrentSeason(now),
			limit: subject ? 1 : query.limit ?? 10,
			subject
		};
	}

	if (query.operation === 'standings' && query.entity === 'team') {
		const subject = resolveTeamEntity(query.subject);
		if (subject && 'warning' in subject) {
			return subject.resolvedQuery === null ? subject : { ...subject, resolvedQuery: query };
		}

		return {
			type: 'team_standings',
			query: buildCanonicalResolvedQuery(query, now, [], subject),
			season: query.filters.season ?? resolveCurrentSeason(now),
			limit: subject ? 1 : query.limit ?? 10,
			subject
		};
	}

	if (query.operation === 'game' && query.entity === 'team') {
		const subject = resolveTeamEntity(query.subject);
		if (subject && 'warning' in subject) {
			return subject.resolvedQuery === null ? subject : { ...subject, resolvedQuery: query };
		}
		if (!subject) {
			return {
				type: 'coverage_gap',
				warning: buildWarning('unsupported_subject_filter', 'game/team requires exactly one resolved team subject.'),
				resolvedQuery: query
			};
		}
		const season = query.filters.season ?? resolveCurrentSeason(now);
		if (season !== resolveCurrentSeason(now)) {
			return {
				type: 'coverage_gap',
				warning: buildWarning('unsupported_season', 'game/team execution is limited to the current season in this slice.'),
				resolvedQuery: buildCanonicalResolvedQuery(query, now, [], subject)
			};
		}

		const canonicalQuery = buildCanonicalResolvedQuery(query, now, [], subject);
		try {
			return createTeamGamePlan(canonicalQuery, season, subject, now);
		} catch (error) {
			return {
				type: 'coverage_gap',
				warning: buildWarning(
					'unsupported_query_shape',
					error instanceof Error ? error.message : 'game/team could not be planned from the provided filters.'
				),
				resolvedQuery: canonicalQuery
			};
		}
	}

	return {
		type: 'coverage_gap',
		warning: buildWarning(
			'unsupported_query_shape',
			'This slice supports player rankings, player trends, player comparisons, and team defensive rankings.'
		),
		resolvedQuery: query
	};
}

function buildPlayerRankingRequest(plan: RankingPlan): EndpointFetchRequest {
	return buildLeagueWidePlayerRankingRequest(plan.season, plan.query.filters.seasonType ?? 'Regular Season');
}

function buildPlayerLookupRequest(plan: LookupPlan): EndpointFetchRequest {
	return buildLeagueWidePlayerRankingRequest(plan.season, plan.query.filters.seasonType ?? 'Regular Season');
}

/* Helper functions */

function buildTeamSeasonStatsRequest(
	season: string,
	seasonType: string,
	measureType: 'Base' | 'Advanced'
): EndpointFetchRequest {
	return {
		endpointId: 'leaguedashteamstats',
		params: {
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
			SeasonType: seasonType,
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
		}
	};
}

function teamLookupRequiresAdvancedMetrics(metrics: string[]): boolean {
	return metrics.some((metric) => metric === 'ortg' || metric === 'drtg');
}

function buildTeamLookupRequests(plan: TeamLookupPlan): EndpointFetchRequest[] {
	const seasonType = plan.query.filters.seasonType ?? 'Regular Season';
	const requests = [buildTeamSeasonStatsRequest(plan.season, seasonType, 'Base')];

	if (teamLookupRequiresAdvancedMetrics(plan.query.metrics)) {
		requests.push(buildTeamSeasonStatsRequest(plan.season, seasonType, 'Advanced'));
	}

	return requests;
}

function buildPlayerTrendRequest(plan: TrendPlan): EndpointFetchRequest {
	return {
		endpointId: 'playergamelog',
		params: {
			PlayerID: plan.subject.id,
			Season: plan.season,
			SeasonType: plan.query.filters.seasonType ?? 'Regular Season',
			LeagueID: '',
			DateFrom: plan.query.filters.dateFrom ?? '',
			DateTo: plan.query.filters.dateTo ?? ''
		}
	};
}

function buildPlayerComparisonRequests(plan: ComparisonPlan): EndpointFetchRequest[] {
	return plan.subjects.map((subject) => ({
		endpointId: 'playercareerstats',
		params: {
			PerMode: 'PerGame',
			PlayerID: subject.id,
			LeagueID: ''
		}
	}));
}

function buildTeamRankingRequest(plan: TeamRankingPlan): EndpointFetchRequest {
	return buildLeagueWideTeamDefenseRequest(plan.season, plan.query.filters.seasonType ?? 'Regular Season');
}

function buildTeamStandingsRequest(plan: TeamStandingsPlan): EndpointFetchRequest {
	return buildLeagueStandingsRequest(plan.season, plan.query.filters.seasonType ?? 'Regular Season');
}

function buildEndpointRequests(plan: ExecutionPlan): EndpointFetchRequest[] {
	if (plan.type === 'player_lookup') {
		return [buildPlayerLookupRequest(plan)];
	}

	if (plan.type === 'team_lookup') {
		return buildTeamLookupRequests(plan);
	}

	if (plan.type === 'player_ranking') {
		return [buildPlayerRankingRequest(plan)];
	}

	if (plan.type === 'player_trend') {
		return [buildPlayerTrendRequest(plan)];
	}

	if (plan.type === 'player_comparison') {
		return buildPlayerComparisonRequests(plan);
	}

	if (plan.type === 'team_standings') {
		return [buildTeamStandingsRequest(plan)];
	}

	if (plan.type === 'team_game') {
		return buildTeamGameRequests(plan);
	}

	return [buildTeamRankingRequest(plan)];
}

function buildTraceFromResponse(
	traceId: string,
	normalizedQuestion: string,
	status: StatsQueryStatus,
	resolvedQuery: SemanticQuery | null,
	dataFreshnessMode: DataFreshnessMode,
	sourceCalls: TraceSourceCall[],
	executedSources: Citation[],
	warnings: StatsQueryWarning[],
	latencyMs: QueryTraceResponse['latencyMs'],
	cache: QueryTraceResponse['cache']
): SemanticQueryTraceResponse {
	return {
		traceId,
		normalizedQuestion,
		status,
		resolvedQuery,
		dataFreshnessMode,
		sourceCalls,
		executedSources,
		warnings,
		computations: [],
		latencyMs,
		cache
	};
}

function makeResponse(
	status: StatsQueryStatus,
	result: StatsQueryResult | null,
	citations: Citation[],
	resolvedQuery: SemanticQuery | null,
	dataFreshnessMode: DataFreshnessMode,
	sourceCalls: TraceSourceCall[],
	warnings: StatsQueryWarning[],
	traceId: string
): StatsQueryResponse {
	return {
		status,
		result,
		citations,
		provenance: {
			executor: 'semantic_executor',
			resolvedQuery,
			dataFreshnessMode,
			sourceCalls
		},
		warnings,
		traceId
	};
}

export function buildSemanticNonOkResponse(
	status: Exclude<StatsQueryStatus, 'ok'>,
	normalizedQuestion: string,
	warning: StatsQueryWarning,
	resolvedQuery: SemanticQuery | null,
	planningLatencyMs = 0
): StatsQueryResponse {
	const traceId = crypto.randomUUID();
	const latencyMs = buildLatency({
		planning: planningLatencyMs,
		retrieval: 0,
		compute: 0,
		render: 0
	});
	const trace = buildTraceFromResponse(traceId, normalizedQuestion, status, resolvedQuery, 'nightly', [], [], [warning], latencyMs, {
		hits: 0,
		misses: 0
	});
	saveSemanticTrace(trace);
	return makeResponse(status, null, [], resolvedQuery, 'nightly', [], [warning], traceId);
}

function analyzeStructuredQuery(
	query: SemanticQuery,
	now: Date
): ExecutionPlan | WarningResult {
	return determineSupportedPlan(query, now);
}

function buildMissingPayloadWarning(retrieval: RetrievalOutcome): StatsQueryWarning | null {
	const missingPayload = retrieval.responses.find((response) => response.result.payload === null);
	if (!missingPayload) {
		return null;
	}

	return buildWarning(
		'nightly_data_unavailable',
		'No stored nightly endpoint payload was available for one or more required requests.'
	);
}

function buildMissingLookupRowWarning(plan: ExecutionPlan, retrieval: RetrievalOutcome): StatsQueryWarning | null {
	if (plan.type === 'team_lookup') {
		const payloads = retrieval.responses.map((response) => response.result.payload);
		const missingTeamRow = !payloads.every((payload) => {
			const candidate = payload as
				| {
						resultSet?: { headers?: unknown; rowSet?: unknown };
						resultSets?: Array<{ name?: string; headers?: unknown; rowSet?: unknown }>;
				  }
				| null
				| undefined;
			const resultSet =
				(candidate?.resultSet && Array.isArray(candidate.resultSet.headers) && Array.isArray(candidate.resultSet.rowSet)
					? candidate.resultSet
					: null) ??
				(Array.isArray(candidate?.resultSets)
					? candidate.resultSets.find(
							(entry) =>
								entry.name === 'LeagueDashTeamStats' &&
								Array.isArray(entry.headers) &&
								Array.isArray(entry.rowSet)
						)
					: null);

			if (!resultSet || !Array.isArray(resultSet.headers) || !Array.isArray(resultSet.rowSet)) {
				return false;
			}

			const teamIdIndex = resultSet.headers.indexOf('TEAM_ID');
			if (teamIdIndex < 0) {
				return false;
			}

			return resultSet.rowSet.some((row) => Array.isArray(row) && String(row[teamIdIndex] ?? '') === plan.subject.id);
		});

		return missingTeamRow
			? buildWarning(
					'nightly_data_unavailable',
					'No stored nightly season row was available for the resolved team lookup subject.'
				)
			: null;
	}

	if (plan.type === 'team_standings') {
		if (!plan.subject) {
			return null;
		}
		const subject = plan.subject;

		const payload = retrieval.responses[0]?.result.payload as
			| {
					resultSet?: { headers?: unknown; rowSet?: unknown };
					resultSets?: Array<{ name?: string; headers?: unknown; rowSet?: unknown }>;
			  }
			| null
			| undefined;
		const resultSet =
			(payload?.resultSet && Array.isArray(payload.resultSet.headers) && Array.isArray(payload.resultSet.rowSet)
				? payload.resultSet
				: null) ??
			(Array.isArray(payload?.resultSets)
				? payload.resultSets.find(
						(entry) => entry.name === 'Standings' && Array.isArray(entry.headers) && Array.isArray(entry.rowSet)
					)
				: null);

		if (!resultSet || !Array.isArray(resultSet.headers) || !Array.isArray(resultSet.rowSet)) {
			return null;
		}

		const teamIdIndex = resultSet.headers.indexOf('TeamID');
		if (teamIdIndex < 0) {
			return null;
		}

		const hasRow = resultSet.rowSet.some(
			(row) => Array.isArray(row) && String(row[teamIdIndex] ?? '') === subject.id
		);
		return hasRow
			? null
			: buildWarning(
					'nightly_data_unavailable',
					'No stored nightly standings row was available for the resolved team subject.'
				);
	}

	if (plan.type === 'team_game') {
		return buildMissingTeamGameWarning(
			plan,
			retrieval.responses.map((response) => response.result.payload)
		);
	}

	if (plan.type !== 'player_lookup') {
		return null;
	}

	const payload = retrieval.responses[0]?.result.payload as
		| {
				resultSet?: { headers?: unknown; rowSet?: unknown };
				resultSets?: Array<{ name?: string; headers?: unknown; rowSet?: unknown }>;
		  }
		| null
		| undefined;
	const resultSet =
		(payload?.resultSet && Array.isArray(payload.resultSet.headers) && Array.isArray(payload.resultSet.rowSet)
			? payload.resultSet
			: null) ??
		(Array.isArray(payload?.resultSets)
			? payload.resultSets.find(
					(entry) =>
						entry.name === 'LeagueDashPlayerStats' &&
						Array.isArray(entry.headers) &&
						Array.isArray(entry.rowSet)
					)
			: null);

	if (!resultSet || !Array.isArray(resultSet.headers) || !Array.isArray(resultSet.rowSet)) {
		return null;
	}

	const playerIdIndex = resultSet.headers.indexOf('PLAYER_ID');
	if (playerIdIndex < 0) {
		return null;
	}

	const hasRow = resultSet.rowSet.some(
		(row) => Array.isArray(row) && String(row[playerIdIndex] ?? '') === plan.subject.id
	);
	if (hasRow) {
		return null;
	}

	return buildWarning(
		'nightly_data_unavailable',
		'No stored nightly season row was available for the resolved player lookup subject.'
	);
}

function parseExecutionResult(plan: ExecutionPlan, retrieval: RetrievalOutcome): StatsQueryResult {
	if (plan.type === 'player_lookup') {
		const payload = retrieval.responses[0]?.result.payload;
		return extractPlayerLookupRow(
			payload,
			{
				playerId: plan.subject.id,
				playerName: plan.subject.name
			},
			plan.query.metrics,
			plan.season,
			plan.query.filters.seasonType ?? 'Regular Season'
		);
	}

	if (plan.type === 'team_lookup') {
		return extractTeamLookupRow(
			{
				base: retrieval.responses[0]?.result.payload,
				advanced: retrieval.responses[1]?.result.payload ?? retrieval.responses[0]?.result.payload
			},
			{
				teamId: plan.subject.id,
				teamName: plan.subject.name
			},
			plan.query.metrics,
			plan.season,
			plan.query.filters.seasonType ?? 'Regular Season'
		);
	}

	if (plan.type === 'player_ranking') {
		const payload = retrieval.responses[0]?.result.payload;
		return extractPlayerRankingRows(payload, plan.query.metrics, plan.limit, plan.query.orderBy ?? null, plan.season);
	}

	if (plan.type === 'player_trend') {
		const payload = retrieval.responses[0]?.result.payload;
		return extractPlayerTrendRows(
			payload,
			plan.query.metrics,
			plan.query.filters.window ?? null,
			plan.sampleLimit,
			plan.subject.name
		);
	}

	if (plan.type === 'player_comparison') {
		return extractPlayerComparisonRows(
			plan.subjects.map((subject, index) => ({
				subject: subject.name,
				payload: retrieval.responses[index]?.result.payload
			})),
			plan.query.metrics,
			plan.season
		);
	}

	if (plan.type === 'team_standings') {
		if (plan.subject) {
			return extractTeamStandingsRow(
				retrieval.responses[0]?.result.payload,
				{ teamId: plan.subject.id, teamName: plan.subject.name },
				plan.query.metrics,
				plan.season,
				plan.query.filters.seasonType ?? 'Regular Season',
				{
					conference: plan.query.filters.conference ?? null,
					division: plan.query.filters.division ?? null
				}
			);
		}

		return extractTeamStandingsRankingRows(
			retrieval.responses[0]?.result.payload,
			plan.query.metrics,
			plan.limit,
			Object.fromEntries(
				plan.query.metrics.map((metric) => [
					metric,
					getDefaultMetricSortDirection('standings', 'team', metric) ?? 'desc'
				])
			),
			plan.season,
			{
				conference: plan.query.filters.conference ?? null,
				division: plan.query.filters.division ?? null
			}
		);
	}

	if (plan.type === 'team_game') {
		return extractTeamGameResult(
			plan,
			retrieval.responses.map((response) => response.result.payload)
		);
	}

	return extractTeamRankingRows(
		retrieval.responses[0]?.result.payload,
		plan.query.metrics[0],
		plan.limit,
		plan.query.orderBy ?? null,
		plan.subject ? { teamId: plan.subject.id, canonicalName: plan.subject.name } : null,
		plan.season
	);
}

function normalizeChatToSemanticQuery(request: ChatQueryRequest): WarningResult | SemanticQueryRequest {
	const normalizedQuestion = normalizeQuestion(request.message);
	const resolvedMetrics = resolveMetrics(normalizedQuestion);
	if (resolvedMetrics.unresolvedTerms.length > 0) {
		return {
			type: 'coverage_gap',
			warning: buildWarning(
				'unsupported_metric',
				`Unsupported metric cues detected: ${resolvedMetrics.unresolvedTerms.join(', ')}.`
			),
			resolvedQuery: null
		};
	}

	const metrics = resolvedMetrics.metrics.map((metric) => metric.id);
	const season = extractSeason(normalizedQuestion);
	const window = extractWindowFilter(normalizedQuestion);
	const players = extractPlayers(normalizedQuestion);

	if (includesAny(normalizedQuestion, COMPARE_KEYWORDS)) {
		if (players.length !== 2) {
			return {
				type: 'clarification_needed',
				warning: buildWarning('compare_requires_two_subjects', 'Player comparisons require exactly two player names in this slice.'),
				resolvedQuery: null
			};
		}

		return {
			question: request.message,
			query: {
				operation: 'compare',
				entity: 'player',
				subject: { names: players },
				metrics: metrics.length > 0 ? metrics : defaultMetricForQuery('compare', 'player'),
				filters: {
					season,
					seasonType: null,
					window: null,
					dateFrom: null,
					dateTo: null
				},
				orderBy: null,
				limit: null,
				outputMode: 'comparison'
			}
		};
	}

	if ((includesAny(normalizedQuestion, TREND_KEYWORDS) || window !== null) && players.length === 1) {
		return {
			question: request.message,
			query: {
				operation: 'trend',
				entity: 'player',
				subject: { names: players },
				metrics: metrics.length > 0 ? metrics : defaultMetricForQuery('trend', 'player'),
				filters: {
					season,
					seasonType: null,
					window,
					dateFrom: null,
					dateTo: null
				},
				orderBy: null,
				limit: null,
				outputMode: 'timeseries'
			}
		};
	}

	if (
		(includesAny(normalizedQuestion, TEAM_TERMS) || includesAny(normalizedQuestion, TEAM_RANKING_KEYWORDS)) &&
		(metrics.includes('drtg') || includesKeyword(normalizedQuestion, 'defensive rating') || includesKeyword(normalizedQuestion, 'drtg'))
	) {
		return {
			question: request.message,
			query: {
				operation: 'rank',
				entity: 'team',
				subject: {},
				metrics: ['drtg'],
				filters: {
					season,
					seasonType: null,
					window: null,
					dateFrom: null,
					dateTo: null
				},
				orderBy: null,
				limit: null,
				outputMode: 'table'
			}
		};
	}

	if (includesAny(normalizedQuestion, LEADER_KEYWORDS) && (metrics.length > 0 || players.length === 0)) {
		return {
			question: request.message,
			query: {
				operation: 'rank',
				entity: 'player',
				subject: {},
				metrics: metrics.length > 0 ? metrics : defaultMetricForQuery('rank', 'player'),
				filters: {
					season,
					seasonType: null,
					window: null,
					dateFrom: null,
					dateTo: null
				},
				orderBy: null,
				limit: null,
				outputMode: 'table'
			}
		};
	}

	return {
		type: 'coverage_gap',
		warning: buildWarning(
			'unsupported_query_shape',
			'This slice supports player rankings, player trends, player comparisons, and team defensive rankings.'
		),
		resolvedQuery: null
	};
}

export function validateChatSemanticQueryRequest(input: unknown): ValidationResult<ChatQueryRequest> {
	if (!input || typeof input !== 'object') {
		return { ok: false, error: 'Request body must be a JSON object.' };
	}

	const { sessionId, message, clientTs } = input as Partial<ChatQueryRequest>;

	if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
		return { ok: false, error: 'sessionId is required.' };
	}

	if (typeof message !== 'string' || message.trim().length === 0) {
		return { ok: false, error: 'message is required.' };
	}

	if (clientTs !== undefined && typeof clientTs !== 'string') {
		return { ok: false, error: 'clientTs must be a string when provided.' };
	}

	return {
		ok: true,
		value: {
			sessionId: sessionId.trim(),
			message: message.trim(),
			clientTs
		}
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
		operation !== 'standings' &&
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

	if (entity === 'player') {
		if (hasStoredPlayerDirectorySnapshot() || ensurePlayerDirectoryAvailable().ok) {
			const subjectConflictError = validateStructuredPlayerSubjectPairs(subject.value);
			if (subjectConflictError) {
				return { ok: false, error: subjectConflictError };
			}
		}
	}

	if (entity === 'team') {
		const subjectConflictError = validateStructuredTeamSubjectPairs(subject.value);
		if (subjectConflictError) {
			return { ok: false, error: subjectConflictError };
		}
	}

	const capabilityValidation = validateSemanticCapabilityQueryShape({
		operation,
		entity,
		subject: subject.value,
		metrics: metrics.value,
		filters: filters.value,
		outputMode: outputMode.value
	});
	if (!capabilityValidation.ok) {
		return capabilityValidation;
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
			}
		}
	};
}

/**
 * Executes supported semantic queries directly against NBA endpoint payloads and returns structured rows.
 */
export async function executeSemanticQuery(request: SemanticQueryRequest, now: Date = new Date()): Promise<StatsQueryResponse> {
	const normalizedQuestion = normalizeQuestion(request.question ?? buildTraceQuestion(request.query));
	const traceId = crypto.randomUUID();
	const planningStartedAt = performance.now();
	const analysis = analyzeStructuredQuery(request.query, now);
	const planningLatencyMs = Math.round(performance.now() - planningStartedAt);

	if (isWarningResult(analysis)) {
		const trace = buildTraceFromResponse(
			traceId,
			normalizedQuestion,
			analysis.type,
			analysis.resolvedQuery,
			'nightly',
			[],
			[],
			[analysis.warning],
			buildLatency({
				planning: planningLatencyMs,
				retrieval: 0,
				compute: 0,
				render: 0
			}),
			{ hits: 0, misses: 0 }
		);
		saveSemanticTrace(trace);
		return makeResponse(analysis.type, null, [], analysis.resolvedQuery, 'nightly', [], [analysis.warning], traceId);
	}

	const retrieval = await executeEndpointRequests(buildEndpointRequests(analysis));
	const computeStartedAt = performance.now();
	const missingPayloadWarning = buildMissingPayloadWarning(retrieval);
	const missingLookupRowWarning = buildMissingLookupRowWarning(analysis, retrieval);

	if (missingPayloadWarning || missingLookupRowWarning) {
		const warning = missingPayloadWarning ?? missingLookupRowWarning ?? buildWarning('nightly_data_unavailable', 'No stored nightly data was available.');
		const latencyMs = buildLatency({
			planning: planningLatencyMs,
			retrieval: retrieval.retrievalLatencyMs,
			compute: 0,
			render: 0
		});
		const trace = buildTraceFromResponse(
			traceId,
			normalizedQuestion,
			'coverage_gap',
			analysis.query,
			retrieval.dataFreshnessMode,
			retrieval.sourceCalls,
			retrieval.citations,
			[warning],
			latencyMs,
			retrieval.cache
		);
		saveSemanticTrace(trace);
		return makeResponse(
			'coverage_gap',
			null,
			retrieval.citations,
			analysis.query,
			retrieval.dataFreshnessMode,
			retrieval.sourceCalls,
			[warning],
			traceId
		);
	}

	try {
		const result = parseExecutionResult(analysis, retrieval);
		const latencyMs = buildLatency({
			planning: planningLatencyMs,
			retrieval: retrieval.retrievalLatencyMs,
			compute: Math.round(performance.now() - computeStartedAt),
			render: 0
		});
		const trace = buildTraceFromResponse(
			traceId,
			normalizedQuestion,
			'ok',
			analysis.query,
			retrieval.dataFreshnessMode,
			retrieval.sourceCalls,
			retrieval.citations,
			[],
			latencyMs,
			retrieval.cache
		);
		saveSemanticTrace(trace);
		return makeResponse('ok', result, retrieval.citations, analysis.query, retrieval.dataFreshnessMode, retrieval.sourceCalls, [], traceId);
	} catch (error) {
		const warning = buildWarning(
			'extraction_failed',
			error instanceof SemanticExtractionError ? error.message : 'Structured rows could not be extracted from the source payload.'
		);
		const latencyMs = buildLatency({
			planning: planningLatencyMs,
			retrieval: retrieval.retrievalLatencyMs,
			compute: Math.round(performance.now() - computeStartedAt),
			render: 0
		});
		const trace = buildTraceFromResponse(
			traceId,
			normalizedQuestion,
			'coverage_gap',
			analysis.query,
			retrieval.dataFreshnessMode,
			retrieval.sourceCalls,
			retrieval.citations,
			[warning],
			latencyMs,
			retrieval.cache
		);
		saveSemanticTrace(trace);
		return makeResponse(
			'coverage_gap',
			null,
			retrieval.citations,
			analysis.query,
			retrieval.dataFreshnessMode,
			retrieval.sourceCalls,
			[warning],
			traceId
		);
	}
}

export async function executeChatSemanticQuery(request: ChatQueryRequest, now: Date = new Date()): Promise<StatsQueryResponse> {
	const translated = normalizeChatToSemanticQuery(request);
	if (isWarningResult(translated)) {
		return buildSemanticNonOkResponse(
			translated.type,
			normalizeQuestion(request.message),
			translated.warning,
			translated.resolvedQuery
		);
	}

	return await executeSemanticQuery(translated, now);
}
