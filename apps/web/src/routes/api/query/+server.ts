import { admitResearch, guardModel } from '$lib/server/beta/limits';
import { BetaError } from '$lib/server/beta/config';
import { json } from '@sveltejs/kit';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import type { QueryAnswerRequest } from '$lib/contracts/query-context';
import type { QueryProgress, QueryStreamEvent } from '$lib/contracts/query-progress';
import { QuerySessionExpiredError } from '$lib/server/agent/query-session-store';
import type { AnswerRendererService } from '$lib/server/answer-renderer/service';
import { createDeterministicAnswerRendererService } from '$lib/server/answer-renderer/service';
import type { DynamicQueryAgent } from '$lib/server/agent/types';
import type { PlannerService } from '$lib/server/planner/service';
import { createQueryOrchestratorService, type QueryOrchestratorService } from '$lib/server/query-orchestrator/service';
import { createSemanticBatchExecutor } from '$lib/server/query-orchestrator/semantic-batch-executor';
import {
	buildSemanticNonOkResponse,
	executeSemanticQuery,
	validateSemanticQueryRequest
} from '$lib/server/semantic/query-service';
import type { RequestHandler } from './$types';

type QueryRouteRuntime = {
	answerQuestion: DynamicQueryAgent['answerQuestion'];
};

type DynamicQueryRouteDependencies = {
	answerQuestion: DynamicQueryAgent['answerQuestion'];
};

type LegacyPlannerRouteDependencies = {
	planQuestion: PlannerService['planQuestion'];
	executeSemanticQuery: typeof executeSemanticQuery;
	renderAnswer?: AnswerRendererService['renderAnswer'];
};

type QueryRouteTestDependencies = DynamicQueryRouteDependencies | LegacyPlannerRouteDependencies;

let testDependencies: QueryRouteRuntime | null = null;
let defaultDynamicAgent: DynamicQueryAgent | null = null;
let testDefaultDynamicAgentFactory: (() => Promise<DynamicQueryAgent>) | null = null;
let testDefaultPlannerFactory: (() => Promise<PlannerService>) | null = null;

/**
 * Allows route tests to isolate the dynamic query engine without relying on live model calls.
 */
export function _setQueryRouteDependenciesForTests(dependencies: QueryRouteTestDependencies | null): void {
	if (!dependencies) {
		testDependencies = null;
		return;
	}

	if (isDynamicQueryRouteDependencies(dependencies)) {
		testDependencies = {
			answerQuestion: dependencies.answerQuestion
		};
		return;
	}

	testDependencies = {
		answerQuestion: createLegacyOrchestratorForCompatibility(dependencies).answerQuestion
	};
}

/**
 * Allows route tests to prove injected dependencies bypass default dynamic-agent creation.
 */
export function _setDefaultDynamicAgentFactoryForTests(factory: (() => Promise<DynamicQueryAgent>) | null): void {
	testDefaultDynamicAgentFactory = factory;
	defaultDynamicAgent = null;
}

/**
 * Retained for older planner-route tests that still import the legacy helper.
 */
export function _setDefaultPlannerFactoryForTests(factory: (() => Promise<PlannerService>) | null): void {
	testDefaultPlannerFactory = factory;
	defaultDynamicAgent = null;
}

export const POST: RequestHandler = async ({ request }) => {
	const contentLength = Number(request.headers.get('content-length') ?? 0);
	if (contentLength > 16_384) return json({ error: 'Request body is too large.' }, { status: 413 });
	let body: unknown;
	try {
		const source = await request.text();
		if (new TextEncoder().encode(source).byteLength > 16_384) return json({ error: 'Request body is too large.' }, { status: 413 });
		body = JSON.parse(source);
	} catch {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}

	const parsed = validateQueryQuestionRequest(body);
	if (!parsed.ok) {
		return json({ error: parsed.error }, { status: 400 });
	}

	try {
		const dependencies = await getDependencies();
		const admission = admitResearch();
		const guarded: QueryRouteRuntime = { answerQuestion: (question, options) => admission.run(async () => {
			try { return await dependencies.answerQuestion(question, options); } finally { admission.release(); }
		}) };
		if (request.headers.get('accept')?.includes('text/event-stream')) return streamResearchAnswer(guarded, parsed.value, request.signal);
		const answer = await guarded.answerQuestion(parsed.value.question, { sessionId: parsed.value.sessionId, signal: request.signal });
		return json(answer, { status: 200 });
	} catch (error) {
		if (error instanceof BetaError) return json({ error: error.message, code: error.code }, { status: error.status, headers: error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {} });
		if (error instanceof QuerySessionExpiredError) return json({ error: error.message, code: 'session_expired' }, { status: 409 });
		console.error('Unexpected dynamic query handler error:', describeQueryError(error));
		return json({ error: 'Internal server error.' }, { status: 500 });
	}
};

/* Helper functions */

/** One request carries source progress, verified artifact snapshots, and the final answer. */
function streamResearchAnswer(runtime: QueryRouteRuntime, input: QueryAnswerRequest, requestSignal: AbortSignal): Response {
	const cancellation = new AbortController();
	const signal = AbortSignal.any([requestSignal, cancellation.signal]);
	const encoder = new TextEncoder();
	let closed = false;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let progress: QueryProgress = { stage: 'planning', message: 'Reading your question', completedTools: 0, elapsedMs: 0 };
			let updatedAt = Date.now();
			const send = (event: QueryStreamEvent) => {
				if (!closed && !signal.aborted) controller.enqueue(encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`));
			};
			send({ event: 'progress', data: progress });
			heartbeat = setInterval(() => send({ event: 'progress', data: { ...progress, elapsedMs: progress.elapsedMs + Date.now() - updatedAt } }), 5_000);
			void runtime.answerQuestion(input.question, {
				sessionId: input.sessionId, signal,
				onProgress(next) { progress = next; updatedAt = Date.now(); send({ event: 'progress', data: next }); },
				onArtifacts(artifacts) { send({ event: 'artifacts', data: { artifacts } }); }
			}).then((answer) => send({ event: 'result', data: answer })).catch((error: unknown) => {
				if (signal.aborted) return;
				if (error instanceof BetaError) send({ event: 'error', data: { message: error.message, code: error.code } });
				else if (error instanceof QuerySessionExpiredError) send({ event: 'error', data: { message: error.message, code: 'session_expired' } });
				else if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'APIConnectionTimeoutError')) send({ event: 'error', data: { message: 'This research reached its time limit. Try a narrower question or retry.', code: 'query_timeout' } });
				else if (error && typeof error === 'object' && 'status' in error && error.status === 429) send({ event: 'error', data: { message: 'The answer service is temporarily busy. Please retry shortly.', code: 'model_busy' } });
				else {
					console.error('Unexpected streaming query error:', describeQueryError(error));
					send({ event: 'error', data: { message: 'The research could not finish. Please retry.', code: 'query_failed' } });
				}
			}).finally(() => {
				clearInterval(heartbeat);
				if (!closed) { closed = true; controller.close(); }
			});
		},
		cancel() { closed = true; clearInterval(heartbeat); cancellation.abort(new DOMException('Research cancelled', 'AbortError')); }
	});
	return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}

function describeQueryError(error: unknown): { name: string } {
	return { name: error instanceof Error ? error.name : 'UnknownError' };
}

async function getDependencies(): Promise<QueryRouteRuntime> {
	if (testDependencies) {
		return testDependencies;
	}

	const agent = await getDefaultDynamicAgent();
	return {
		answerQuestion: agent.answerQuestion
	};
}

async function getDefaultDynamicAgent(): Promise<DynamicQueryAgent> {
	if (defaultDynamicAgent) {
		return defaultDynamicAgent;
	}

	if (testDefaultDynamicAgentFactory) {
		defaultDynamicAgent = await testDefaultDynamicAgentFactory();
		return defaultDynamicAgent;
	}

	const [
		{ createDynamicQueryAgent, createDefaultPlayerDirectoryAdapter, createDefaultTeamDirectoryAdapter },
		{ createOpenAIDynamicAgentAdapter },
		{ createStatsEndpointFetcher }
	] = await Promise.all([
		import('$lib/server/agent/service'),
		import('$lib/server/agent/openai-adapter'),
		import('$lib/server/data/adapters/stats-endpoint-client')
	]);

	defaultDynamicAgent = createDynamicQueryAgent({
		model: guardModel(createOpenAIDynamicAgentAdapter()),
		endpointFetcher: createStatsEndpointFetcher(),
		playerDirectory: createDefaultPlayerDirectoryAdapter(),
		teamDirectory: createDefaultTeamDirectoryAdapter()
	});
	return defaultDynamicAgent;
}

function createLegacyOrchestratorForCompatibility(dependencies: LegacyPlannerRouteDependencies): QueryOrchestratorService {
	return createQueryOrchestratorService({
		planner: {
			planQuestion: dependencies.planQuestion
		},
		renderer: {
			renderAnswer:
				dependencies.renderAnswer ??
				createDeterministicAnswerRendererService().renderAnswer
		},
		batchExecutor: createSemanticBatchExecutor({
			validateSemanticQueryRequest,
			executeSemanticQuery: dependencies.executeSemanticQuery
		}),
		buildSemanticNonOkResponse
	});
}

function isDynamicQueryRouteDependencies(
	dependencies: QueryRouteTestDependencies
): dependencies is DynamicQueryRouteDependencies {
	return 'answerQuestion' in dependencies;
}

function validateQueryQuestionRequest(input: unknown): { ok: true; value: QueryAnswerRequest } | { ok: false; error: string } {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return { ok: false, error: 'Request body must be a JSON object.' };
	}

	const { question, sessionId } = input as { question?: unknown; sessionId?: unknown };
	if (Object.keys(input).some((key) => key !== 'question' && key !== 'sessionId')) {
		return { ok: false, error: 'Only question and optional sessionId are accepted.' };
	}
	if (typeof question !== 'string' || question.trim().length === 0) {
		return { ok: false, error: 'question is required.' };
	}
	if (question.trim().length > 4_000) return { ok: false, error: 'question must be at most 4000 characters.' };
	if (sessionId !== undefined && (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId))) {
		return { ok: false, error: 'sessionId must be a server-generated research session ID.' };
	}

	return {
		ok: true,
		value: {
			question: question.trim(),
			...(typeof sessionId === 'string' ? { sessionId } : {})
		}
	};
}
