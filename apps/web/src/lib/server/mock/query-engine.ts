import type { ChatQueryRequest, ChatQueryResponse, Citation, QueryTraceResponse } from '$lib/contracts/chat';
import type { QueryIntent, QueryPlan } from '$lib/contracts/query-plan';
import {
	buildQueryPlan,
	normalizeQuestion as normalizePlannedQuestion,
	validateQueryPlan
} from '$lib/server/planner/query-plan';

type SupportedIntent = Exclude<QueryIntent, 'unsupported'>;
type SupportedQueryPlan = QueryPlan & { intent: SupportedIntent };
type LatencyParts = Omit<QueryTraceResponse['latencyMs'], 'total'>;

const traceStore = new Map<string, QueryTraceResponse>();

const INTENT_CITATIONS: Record<SupportedIntent, Citation[]> = {
	league_leaders: [
		{ source: 'NBA stats endpoint: leagueleaders', detail: 'Ranked season leaders by requested metric' },
		{ source: 'NBA stats endpoint: playerprofilev2', detail: 'Player context for top-ranked result' }
	],
	player_trend: [
		{ source: 'NBA stats endpoint: playergamelog', detail: 'Game-level splits for selected player window' },
		{ source: 'NBA stats endpoint: boxscoretraditionalv2', detail: 'Validation sample for windowed aggregation' }
	],
	player_compare: [
		{ source: 'NBA stats endpoint: playercareerstats', detail: 'Aligned seasonal baseline comparison' },
		{ source: 'NBA stats endpoint: leaguedashplayerstats', detail: 'Rate/advanced split context' }
	],
	team_ranking: [
		{ source: 'NBA stats endpoint: leaguedashteamstats', detail: 'Team-level advanced table by season window' },
		{ source: 'NBA stats endpoint: teamdashboardbygeneralsplits', detail: 'Team split context validation' }
	]
};

const INTENT_FOLLOWUPS: Record<SupportedIntent, string[]> = {
	league_leaders: ['Show top 5 leaders', 'Limit to last 10 games', 'Compare with previous season leaders'],
	player_trend: ['Compare against season average', 'Show game-by-game values', 'Add offensive vs defensive split'],
	player_compare: ['Add TS% and usage', 'Limit to playoffs', 'Show season-by-season table'],
	team_ranking: ['Show top 10 teams', 'Filter to one conference', 'Compare with last season']
};

const INTENT_LATENCIES: Record<SupportedIntent, LatencyParts> = {
	league_leaders: { planning: 120, retrieval: 510, compute: 160, render: 80 },
	player_trend: { planning: 130, retrieval: 560, compute: 180, render: 90 },
	player_compare: { planning: 140, retrieval: 620, compute: 210, render: 100 },
	team_ranking: { planning: 125, retrieval: 590, compute: 200, render: 95 }
};

const UNSUPPORTED_LATENCY: LatencyParts = {
	planning: 115,
	retrieval: 0,
	compute: 0,
	render: 65
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

function buildSupportedAnswer(plan: SupportedQueryPlan): string {
	const metricsLabel = formatMetrics(plan);

	if (plan.intent === 'league_leaders') {
		return `League leaders query recognized for ${metricsLabel} ${formatSeason(plan)}. Returning a grounded ranking in this mock slice.`;
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
	executedSources: Citation[],
	latency: QueryTraceResponse['latencyMs']
) {
	traceStore.set(traceId, {
		traceId,
		normalizedQuestion,
		queryPlan,
		executedSources,
		computations: [],
		latencyMs: latency,
		cache: { hits: 0, misses: 0 }
	});
}

function isSupportedPlan(plan: QueryPlan): plan is SupportedQueryPlan {
	return plan.intent !== 'unsupported' && plan.confidence >= 0.5;
}

function createUnsupportedResponse(
	normalizedQuestion: string,
	traceId: string,
	queryPlan: QueryPlan
): ChatQueryResponse {
	saveTrace(traceId, normalizedQuestion, queryPlan, [], buildLatency(UNSUPPORTED_LATENCY));

	return {
		status: 'unsupported',
		answer:
			'This query is not grounded in the current mock slice yet. Try player comparisons, assist leaders, or recent player game-log questions.',
		citations: [],
		traceId,
		followups: ['Compare two players by season', 'Ask for assist leaders by season', 'Ask for last N games rebounds']
	};
}

function createSupportedResponse(
	normalizedQuestion: string,
	traceId: string,
	queryPlan: SupportedQueryPlan
): ChatQueryResponse {
	const citations = INTENT_CITATIONS[queryPlan.intent];
	const followups = INTENT_FOLLOWUPS[queryPlan.intent];
	const latency = buildLatency(INTENT_LATENCIES[queryPlan.intent]);

	saveTrace(traceId, normalizedQuestion, queryPlan, citations, latency);

	return {
		status: 'ok',
		answer: buildSupportedAnswer(queryPlan),
		citations,
		traceId,
		followups
	};
}

export function runMockQuery(request: ChatQueryRequest): ChatQueryResponse {
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

	return createSupportedResponse(normalizedQuestion, traceId, queryPlan);
}

export function getTraceById(traceId: string): QueryTraceResponse | null {
	return traceStore.get(traceId) ?? null;
}
