import type { ChatQueryRequest, ChatQueryResponse, Citation, QueryTraceResponse } from '$lib/contracts/chat';

type MockTemplate = {
	match: (normalizedQuestion: string) => boolean;
	answer: string;
	citations: Citation[];
	followups: string[];
	planSummary: string[];
	latencyMs: number;
};

const traceStore = new Map<string, QueryTraceResponse>();

const MOCK_TEMPLATES: MockTemplate[] = [
	{
		match: (q) => q.includes('assists') && q.includes('2023-24'),
		answer:
			'Tyrese Haliburton led 2023-24 in assists per game in this mock dataset. Ask for split context (month, home/away, or last N games) to drill down.',
		citations: [
			{ source: 'NBA stats endpoint: leagueleaders', detail: 'Season 2023-24, stat category AST' },
			{ source: 'NBA stats endpoint: playerprofilev2', detail: 'Player context and pace adjustment' }
		],
		followups: ['Break that down by month', 'Show top 5 assist leaders', 'Compare with 2022-23 leaders'],
		planSummary: [
			'Normalize question and infer stat category AST.',
			'Resolve season scope 2023-24.',
			'Query league leaders and rank by assists per game.',
			'Return top result with provenance.'
		],
		latencyMs: 1480
	},
	{
		match: (q) => q.includes('jokic') && q.includes('rebound'),
		answer:
			'Nikola Jokic rebounds trend is available. In this mock slice, request accepted with a last-10-game comparison ready for expansion.',
		citations: [
			{ source: 'NBA stats endpoint: playergamelog', detail: 'Nikola Jokic game logs, last 10 games' },
			{ source: 'NBA stats endpoint: boxscoretraditionalv2', detail: 'Rebound validation sample' }
		],
		followups: ['Compare with Sabonis', 'Split by offensive vs defensive rebounds', 'Show game-by-game values'],
		planSummary: [
			'Resolve player identity: Nikola Jokic.',
			'Apply last-10-games filter.',
			'Aggregate rebound metrics and summarize trend.'
		],
		latencyMs: 1630
	},
	{
		match: (q) => q.includes('curry') && q.includes('lillard') && q.includes('compare'),
		answer:
			'Comparison request recognized for Stephen Curry vs Damian Lillard. Mock flow returns grounded comparison scaffolding with citations and trace.',
		citations: [
			{ source: 'NBA stats endpoint: playercareerstats', detail: 'Career and seasonal baselines' },
			{ source: 'NBA stats endpoint: leaguedashplayerstats', detail: 'Per-season advanced splits' }
		],
		followups: ['Compare TS% and usage', 'Limit to playoff games', 'Show season-by-season table'],
		planSummary: [
			'Resolve multi-player entities.',
			'Build aligned season window.',
			'Compute side-by-side comparison fields.',
			'Return comparison summary and follow-ups.'
		],
		latencyMs: 1750
	}
];

export function normalizeQuestion(message: string): string {
	return message.trim().replace(/\s+/g, ' ').toLowerCase();
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

function createUnsupportedResponse(normalizedQuestion: string, traceId: string): ChatQueryResponse {
	traceStore.set(traceId, {
		traceId,
		normalizedQuestion,
		planSummary: [
			'Normalize question and attempt intent extraction.',
			'No grounded mock template found for this request.',
			'Return explicit unsupported response with guidance.'
		],
		executedSources: [],
		latencyMs: { total: 910 }
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

export function runMockQuery(request: ChatQueryRequest): ChatQueryResponse {
	const normalizedQuestion = normalizeQuestion(request.message);
	const traceId = crypto.randomUUID();

	const template = MOCK_TEMPLATES.find((item) => item.match(normalizedQuestion));
	if (!template) {
		return createUnsupportedResponse(normalizedQuestion, traceId);
	}

	traceStore.set(traceId, {
		traceId,
		normalizedQuestion,
		planSummary: template.planSummary,
		executedSources: template.citations,
		latencyMs: { total: template.latencyMs }
	});

	return {
		status: 'ok',
		answer: template.answer,
		citations: template.citations,
		traceId,
		followups: template.followups
	};
}

export function getTraceById(traceId: string): QueryTraceResponse | null {
	return traceStore.get(traceId) ?? null;
}
