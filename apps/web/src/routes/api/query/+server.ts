import { json } from '@sveltejs/kit';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
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
	answerQuestion(question: string): Promise<QueryAnswerResponse>;
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
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}

	const parsed = validateQueryQuestionRequest(body);
	if (!parsed.ok) {
		return json({ error: parsed.error }, { status: 400 });
	}

	try {
		const dependencies = await getDependencies();
		const answer = await dependencies.answerQuestion(parsed.value.question);
		return json(answer, { status: 200 });
	} catch (error) {
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

function validateQueryQuestionRequest(input: unknown): { ok: true; value: { question: string } } | { ok: false; error: string } {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return { ok: false, error: 'Request body must be a JSON object.' };
	}

	const { question } = input as { question?: unknown };
	if (typeof question !== 'string' || question.trim().length === 0) {
		return { ok: false, error: 'question is required.' };
	}

	return {
		ok: true,
		value: {
			question: question.trim()
		}
	};
}
