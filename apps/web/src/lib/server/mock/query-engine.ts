import type {
	ChatQueryRequest,
	ChatQueryResponse,
	Citation,
	DataFreshnessMode,
	QueryTraceResponse,
	TraceSourceCall
} from '$lib/contracts/chat';
import type { QueryIntent, QueryPlan } from '$lib/contracts/query-plan';
import { fetchStatsEndpointWithCache, type EndpointFetchRequest, type EndpointFetchResult } from '$lib/server/data/adapters';
import { getEndpointCatalogEntry } from '$lib/server/data';
import { getDataStore } from '$lib/server/data/store';
import {
	buildQueryPlan,
	normalizeQuestion as normalizePlannedQuestion,
	validateQueryPlan
} from '$lib/server/planner/query-plan';

type SupportedIntent = Exclude<QueryIntent, 'unsupported'>;
type SupportedQueryPlan = QueryPlan & { intent: SupportedIntent };
type LatencyParts = Omit<QueryTraceResponse['latencyMs'], 'total'>;

const traceStore = new Map<string, QueryTraceResponse>();

const INTENT_SOURCE_ENDPOINTS: Record<SupportedIntent, string[]> = {
	league_leaders: ['leagueleaders'],
	player_trend: ['playergamelog'],
	player_compare: ['playercareerstats'],
	team_ranking: ['leaguedashteamstats']
};

const INTENT_FOLLOWUPS: Record<SupportedIntent, string[]> = {
	league_leaders: ['Show top 5 leaders', 'Limit to last 10 games', 'Compare with previous season leaders'],
	player_trend: ['Compare against season average', 'Show game-by-game values', 'Add offensive vs defensive split'],
	player_compare: ['Add TS% and usage', 'Limit to playoffs', 'Show season-by-season table'],
	team_ranking: ['Show top 10 teams', 'Filter to one conference', 'Compare with last season']
};

const INTENT_LATENCIES: Record<SupportedIntent, LatencyParts> = {
	league_leaders: { planning: 120, retrieval: 0, compute: 160, render: 80 },
	player_trend: { planning: 130, retrieval: 0, compute: 180, render: 90 },
	player_compare: { planning: 140, retrieval: 0, compute: 210, render: 100 },
	team_ranking: { planning: 125, retrieval: 0, compute: 200, render: 95 }
};

const UNSUPPORTED_LATENCY: LatencyParts = {
	planning: 115,
	retrieval: 0,
	compute: 0,
	render: 65
};

const METRIC_STAT_CATEGORY: Record<string, string> = {
	ast: 'AST',
	pts: 'PTS',
	reb: 'REB'
};

const PLAYER_ID_BY_NAME: Record<string, string> = {
	'nikola jokic': '203999',
	'stephen curry': '201939',
	'damian lillard': '203081',
	'lebron james': '2544',
	'kevin durant': '201142',
	'tyrese haliburton': '1630169',
	'domantas sabonis': '1627734'
};

type RetrievalOutcome = {
	sourceCalls: TraceSourceCall[];
	citations: Citation[];
	cache: QueryTraceResponse['cache'];
	dataFreshnessMode: DataFreshnessMode;
	retrievalLatencyMs: number;
	resultsByEndpoint: Map<string, EndpointFetchResult[]>;
};

export class QueryEngineInvariantError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'QueryEngineInvariantError';
	}
}

export function isQueryEngineInvariantError(error: unknown): error is QueryEngineInvariantError {
	return error instanceof QueryEngineInvariantError;
}

export function normalizeQuestion(message: string): string {
	return normalizePlannedQuestion(message);
}

function buildUnsupportedTracePlan(reasons: string[]): QueryPlan {
	return {
		intent: 'unsupported',
		entities: {
			players: [],
			teams: [],
			seasons: []
		},
		metrics: [],
		filters: {
			season: null,
			window: null
		},
		confidence: 0.3,
		reasons
	};
}

export function validateChatQueryRequest(input: unknown): { ok: true; value: ChatQueryRequest } | { ok: false; error: string } {
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

function buildLatency(parts: LatencyParts): QueryTraceResponse['latencyMs'] {
	const total = parts.planning + parts.retrieval + parts.compute + parts.render;
	return {
		...parts,
		total
	};
}

function resolveCurrentSeason(now: Date = new Date()): string {
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth() + 1;
	const startYear = month >= 10 ? year : year - 1;
	const endYear = (startYear + 1).toString().slice(-2);
	return `${startYear}-${endYear}`;
}

function resolveSeason(plan: QueryPlan): string {
	return plan.filters.season ?? resolveCurrentSeason();
}

function resolveStatCategory(metricId: string | undefined): string {
	if (!metricId) {
		return 'PTS';
	}
	return METRIC_STAT_CATEGORY[metricId] ?? 'PTS';
}

function buildEndpointRequestsForPlan(plan: SupportedQueryPlan): EndpointFetchRequest[] {
	const season = resolveSeason(plan);

	if (plan.intent === 'league_leaders') {
		return [
			{
				endpointId: 'leagueleaders',
				params: {
					LeagueID: '00',
					PerMode: 'PerGame',
					Scope: 'S',
					Season: season,
					SeasonType: 'Regular Season',
					StatCategory: resolveStatCategory(plan.metrics[0]?.id),
					ActiveFlag: ''
				}
			}
		];
	}

	if (plan.intent === 'player_trend') {
		const playerName = plan.entities.players[0];
		const playerId = playerName ? PLAYER_ID_BY_NAME[playerName] : undefined;
		if (!playerId) {
			return [];
		}

		return [
			{
				endpointId: 'playergamelog',
				params: {
					PlayerID: playerId,
					Season: season,
					SeasonType: 'Regular Season',
					LeagueID: '',
					DateFrom: '',
					DateTo: ''
				}
			}
		];
	}

	if (plan.intent === 'player_compare') {
		const playerIds = plan.entities.players
			.slice(0, 2)
			.map((name) => PLAYER_ID_BY_NAME[name])
			.filter((playerId): playerId is string => typeof playerId === 'string');

		return playerIds.map((playerId) => ({
			endpointId: 'playercareerstats',
			params: {
				PerMode: 'PerGame',
				PlayerID: playerId,
				LeagueID: ''
			}
		}));
	}

	return [
		{
			endpointId: 'leaguedashteamstats',
			params: {
				Conference: '',
				DateFrom: '',
				DateTo: '',
				Division: '',
				GameScope: '',
				GameSegment: '',
				LastNGames: '0',
				LeagueID: '',
				Location: '',
				MeasureType: 'Advanced',
				Month: '0',
				OpponentTeamID: '0',
				Outcome: '',
				PORound: '',
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
				ShotClockRange: '',
				StarterBench: '',
				TeamID: '',
				TwoWay: '',
				VsConference: '',
				VsDivision: ''
			}
		}
	];
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

function buildFallbackSourceCalls(intent: SupportedIntent): TraceSourceCall[] {
	return INTENT_SOURCE_ENDPOINTS[intent].map((endpointId) => {
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

async function executeRetrievalPlan(plan: SupportedQueryPlan): Promise<RetrievalOutcome> {
	const endpointRequests = buildEndpointRequestsForPlan(plan);
	const sourceCalls: TraceSourceCall[] = [];
	const citations: Citation[] = [];
	const resultsByEndpoint = new Map<string, EndpointFetchResult[]>();

	if (endpointRequests.length === 0) {
		const fallbackCalls = buildFallbackSourceCalls(plan.intent);
		return {
			sourceCalls: fallbackCalls,
			citations: fallbackCalls.map((sourceCall) => ({
				source: `NBA stats endpoint: ${sourceCall.endpointId}`,
				detail: 'No resolvable entity IDs available for live fetch in this slice.'
			})),
			cache: {
				hits: 0,
				misses: fallbackCalls.length
			},
			dataFreshnessMode: 'nightly',
			retrievalLatencyMs: 0,
			resultsByEndpoint
		};
	}

	let retrievalLatencyMs = 0;
	for (const request of endpointRequests) {
		let result: EndpointFetchResult;
		try {
			result = await fetchStatsEndpointWithCache(request);
		} catch (error) {
			const fallback = buildFallbackSourceCalls(plan.intent).find((sourceCall) => sourceCall.endpointId === request.endpointId);
			result = {
				endpointId: request.endpointId,
				payload: null,
				cacheStatus: fallback?.cacheStatus ?? 'miss',
				sourceStatus: 'error',
				latencyMs: 0,
				stale: false,
				isProvisional: false,
				parserVersion: fallback?.parserVersion ?? 'v1',
				errorDetail: String(error)
			};
		}

		retrievalLatencyMs += result.latencyMs;
		sourceCalls.push(sourceCallFromResult(result));
		citations.push(buildCitationFromResult(result));

		if (!resultsByEndpoint.has(result.endpointId)) {
			resultsByEndpoint.set(result.endpointId, []);
		}
		resultsByEndpoint.get(result.endpointId)?.push(result);
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
		resultsByEndpoint
	};
}

function extractResultSet(payload: unknown): { headers: string[]; rowSet: unknown[][] } | null {
	if (!payload || typeof payload !== 'object') {
		return null;
	}

	const candidate = payload as {
		resultSet?: { headers?: unknown; rowSet?: unknown };
		resultSets?: Array<{ headers?: unknown; rowSet?: unknown }>;
	};

	if (candidate.resultSet && Array.isArray(candidate.resultSet.headers) && Array.isArray(candidate.resultSet.rowSet)) {
		return {
			headers: candidate.resultSet.headers.map((value) => String(value)),
			rowSet: candidate.resultSet.rowSet as unknown[][]
		};
	}

	if (Array.isArray(candidate.resultSets)) {
		const dataset = candidate.resultSets.find((resultSet) => Array.isArray(resultSet.headers) && Array.isArray(resultSet.rowSet));
		if (dataset) {
			const headers = Array.isArray(dataset.headers) ? dataset.headers : [];
			const rowSet = Array.isArray(dataset.rowSet) ? (dataset.rowSet as unknown[][]) : [];
			return {
				headers: headers.map((value) => String(value)),
				rowSet
			};
		}
	}

	return null;
}

function formatNumericValue(value: unknown): string {
	if (typeof value === 'number') {
		return Number.isInteger(value) ? `${value}` : value.toFixed(1);
	}

	if (typeof value === 'string') {
		return value;
	}

	return 'N/A';
}

function buildLeagueLeadersAnswer(plan: SupportedQueryPlan, retrieval: RetrievalOutcome): string | null {
	const firstSuccessful = retrieval.resultsByEndpoint
		.get('leagueleaders')
		?.find((result) => result.payload !== null && result.sourceStatus === 'ok');
	if (!firstSuccessful || firstSuccessful.payload === null) {
		return null;
	}

	const resultSet = extractResultSet(firstSuccessful.payload);
	if (!resultSet || resultSet.rowSet.length === 0) {
		return null;
	}

	const statCategory = resolveStatCategory(plan.metrics[0]?.id);
	const playerIndex = resultSet.headers.indexOf('PLAYER');
	const statIndex = resultSet.headers.indexOf(statCategory);
	if (playerIndex < 0 || statIndex < 0) {
		return null;
	}

	const leaderRow = resultSet.rowSet[0];
	const leaderName = String(leaderRow[playerIndex] ?? 'Top player');
	const leaderValue = formatNumericValue(leaderRow[statIndex]);
	const seasonLabel = plan.filters.season ?? 'this season';

	return `${leaderName} currently leads the league in ${statCategory} for ${seasonLabel} at ${leaderValue} per game.`;
}

function saveTraceSourceCalls(traceId: string, dataFreshnessMode: DataFreshnessMode, sourceCalls: TraceSourceCall[]): void {
	try {
		getDataStore().replaceTraceSourceCalls(traceId, dataFreshnessMode, sourceCalls);
	} catch (error) {
		console.error('Trace source-call persistence failed:', error);
	}
}

function loadTraceSourceCalls(traceId: string): {
	dataFreshnessMode: DataFreshnessMode;
	sourceCalls: TraceSourceCall[];
} | null {
	try {
		return getDataStore().getTraceSourceCalls(traceId);
	} catch (error) {
		console.error('Trace source-call load failed:', error);
		return null;
	}
}

function formatMetrics(plan: QueryPlan): string {
	if (plan.metrics.length === 0) {
		return 'requested metric set';
	}
	return plan.metrics.map((metric) => metric.id.toUpperCase()).join(', ');
}

function formatSeason(plan: QueryPlan): string {
	if (plan.filters.season) {
		return `for ${plan.filters.season}`;
	}
	return 'for the current season';
}

function formatWindow(plan: QueryPlan): string {
	if (plan.filters.window) {
		return `over the last ${plan.filters.window.n} games`;
	}
	return 'over the recent sample';
}

function buildSupportedAnswer(plan: SupportedQueryPlan, retrieval: RetrievalOutcome): string {
	const metricsLabel = formatMetrics(plan);

	if (plan.intent === 'league_leaders') {
		const liveAnswer = buildLeagueLeadersAnswer(plan, retrieval);
		if (liveAnswer) {
			return liveAnswer;
		}
		return `League leaders query recognized for ${metricsLabel} ${formatSeason(plan)}. Returning a grounded ranking in this slice.`;
	}

	if (plan.intent === 'player_trend') {
		const player = plan.entities.players[0] ?? 'the selected player';
		return `${player} trend query recognized for ${metricsLabel} ${formatWindow(plan)} ${formatSeason(plan)}. Returning a grounded trend summary.`;
	}

	if (plan.intent === 'player_compare') {
		const playerOne = plan.entities.players[0] ?? 'player one';
		const playerTwo = plan.entities.players[1] ?? 'player two';
		return `Comparison query recognized for ${playerOne} vs ${playerTwo} on ${metricsLabel} ${formatSeason(plan)}. Returning a grounded side-by-side summary.`;
	}

	const teamsLabel = plan.entities.teams.length > 0 ? plan.entities.teams.join(', ') : 'league teams';
	return `Team ranking query recognized for ${teamsLabel} on ${metricsLabel} ${formatSeason(plan)}. Returning a grounded team ranking summary.`;
}

function saveTrace(
	traceId: string,
	normalizedQuestion: string,
	queryPlan: QueryPlan,
	dataFreshnessMode: DataFreshnessMode,
	sourceCalls: TraceSourceCall[],
	executedSources: Citation[],
	latency: QueryTraceResponse['latencyMs'],
	cache: QueryTraceResponse['cache']
) {
	traceStore.set(traceId, {
		traceId,
		normalizedQuestion,
		queryPlan,
		dataFreshnessMode,
		sourceCalls,
		executedSources,
		computations: [],
		latencyMs: latency,
		cache
	});
	saveTraceSourceCalls(traceId, dataFreshnessMode, sourceCalls);
}

function isSupportedPlan(plan: QueryPlan): plan is SupportedQueryPlan {
	return plan.intent !== 'unsupported' && plan.confidence >= 0.5;
}

function createUnsupportedResponse(
	normalizedQuestion: string,
	traceId: string,
	queryPlan: QueryPlan
): ChatQueryResponse {
	saveTrace(traceId, normalizedQuestion, queryPlan, 'nightly', [], [], buildLatency(UNSUPPORTED_LATENCY), {
		hits: 0,
		misses: 0
	});

	return {
		status: 'unsupported',
		answer:
			'This query is not grounded in the current mock slice yet. Try player comparisons, assist leaders, or recent player game-log questions.',
		citations: [],
		traceId,
		followups: ['Compare two players by season', 'Ask for assist leaders by season', 'Ask for last N games rebounds']
	};
}

export function recordUnsupportedLegacyTrace(
	message: string,
	reasons: string[]
): {
	traceId: string;
	normalizedQuestion: string;
	queryPlan: QueryPlan;
} {
	const normalizedQuestion = normalizeQuestion(message);
	const traceId = crypto.randomUUID();
	const queryPlan = buildUnsupportedTracePlan(reasons);

	saveTrace(traceId, normalizedQuestion, queryPlan, 'nightly', [], [], buildLatency(UNSUPPORTED_LATENCY), {
		hits: 0,
		misses: 0
	});

	return {
		traceId,
		normalizedQuestion,
		queryPlan
	};
}

async function createSupportedResponse(
	normalizedQuestion: string,
	traceId: string,
	queryPlan: SupportedQueryPlan
): Promise<ChatQueryResponse> {
	const retrieval = await executeRetrievalPlan(queryPlan);
	const followups = INTENT_FOLLOWUPS[queryPlan.intent];
	const latency = buildLatency({
		...INTENT_LATENCIES[queryPlan.intent],
		retrieval: retrieval.retrievalLatencyMs
	});

	saveTrace(
		traceId,
		normalizedQuestion,
		queryPlan,
		retrieval.dataFreshnessMode,
		retrieval.sourceCalls,
		retrieval.citations,
		latency,
		retrieval.cache
	);

	return {
		status: 'ok',
		answer: buildSupportedAnswer(queryPlan, retrieval),
		citations: retrieval.citations,
		traceId,
		followups
	};
}

export async function runMockQuery(request: ChatQueryRequest): Promise<ChatQueryResponse> {
	const normalizedQuestion = normalizeQuestion(request.message);
	const traceId = crypto.randomUUID();
	const queryPlan = buildQueryPlan(normalizedQuestion);
	const validation = validateQueryPlan(queryPlan);

	if (!validation.ok) {
		throw new QueryEngineInvariantError(validation.error);
	}

	if (!isSupportedPlan(queryPlan)) {
		return createUnsupportedResponse(normalizedQuestion, traceId, queryPlan);
	}

	return await createSupportedResponse(normalizedQuestion, traceId, queryPlan);
}

export function getTraceById(traceId: string): QueryTraceResponse | null {
	const trace = traceStore.get(traceId);
	if (!trace) {
		return null;
	}

	const persistedSourceCalls = loadTraceSourceCalls(traceId);
	if (!persistedSourceCalls) {
		return trace;
	}

	if (persistedSourceCalls.sourceCalls.length === 0) {
		return trace;
	}

	return {
		...trace,
		dataFreshnessMode: persistedSourceCalls.dataFreshnessMode,
		sourceCalls: persistedSourceCalls.sourceCalls
	};
}
