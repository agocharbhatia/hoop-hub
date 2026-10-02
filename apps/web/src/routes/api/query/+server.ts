import { json } from '@sveltejs/kit';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import type { QueryAnswerRequest } from '$lib/contracts/query-context';
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
		const answer = await dependencies.answerQuestion(parsed.value.question, { sessionId: parsed.value.sessionId });
		return json(answer, { status: 200 });
	} catch (error) {
		if (error instanceof QuerySessionExpiredError) return json({ error: error.message, code: 'session_expired' }, { status: 409 });
		console.error('Unexpected dynamic query handler error:', error);
		return json({ error: 'Internal server error.' }, { status: 500 });
	}
};

/* Helper functions */

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
		model: createOpenAIDynamicAgentAdapter(),
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
