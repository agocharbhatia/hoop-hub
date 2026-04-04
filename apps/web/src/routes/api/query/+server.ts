import { json } from '@sveltejs/kit';
import type { AnswerRendererService } from '$lib/server/answer-renderer/service';
import { createDefaultAnswerRendererService } from '$lib/server/answer-renderer/service';
import type { PlannerService } from '$lib/server/planner/service';
import { createPlannerService } from '$lib/server/planner/service';
import { createQueryOrchestratorService, type QueryOrchestratorService } from '$lib/server/query-orchestrator/service';
import { createSemanticBatchExecutor } from '$lib/server/query-orchestrator/semantic-batch-executor';
import {
	buildSemanticNonOkResponse,
	executeSemanticQuery,
	validateSemanticQueryRequest
} from '$lib/server/semantic/query-service';
import type { RequestHandler } from './$types';

type QueryRouteDependencies = {
	orchestrator: QueryOrchestratorService;
};

let testDependencies: QueryRouteDependencies | null = null;
let defaultPlannerService: PlannerService | null = null;
let defaultAnswerRendererService: AnswerRendererService | null = null;
let testDefaultPlannerFactory: (() => Promise<PlannerService>) | null = null;

/**
 * Allows route tests to isolate planner and executor behavior without relying on live model calls.
 */
export function _setQueryRouteDependenciesForTests(
	dependencies:
		| {
				planQuestion: PlannerService['planQuestion'];
				executeSemanticQuery: typeof executeSemanticQuery;
				renderAnswer?: AnswerRendererService['renderAnswer'];
		  }
		| null
): void {
	if (!dependencies) {
		testDependencies = null;
		return;
	}

	testDependencies = {
		orchestrator: createQueryOrchestratorService({
			planner: {
				planQuestion: dependencies.planQuestion
			},
			renderer: {
				renderAnswer:
					dependencies.renderAnswer ??
					createDefaultAnswerRendererService().renderAnswer
			},
			batchExecutor: createSemanticBatchExecutor({
				validateSemanticQueryRequest,
				executeSemanticQuery: dependencies.executeSemanticQuery
			}),
			buildSemanticNonOkResponse
		})
	};
}

/**
 * Allows route tests to prove injected dependencies bypass default planner creation.
 */
export function _setDefaultPlannerFactoryForTests(factory: (() => Promise<PlannerService>) | null): void {
	testDefaultPlannerFactory = factory;
	defaultPlannerService = null;
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
		const dependencies = getDependencies();
		const answer = await dependencies.orchestrator.answerQuestion(parsed.value.question);
		return json(answer, { status: 200 });
	} catch (error) {
		console.error('Unexpected planner query handler error:', error);
		return json({ error: 'Internal server error.' }, { status: 500 });
	}
};

/* Helper functions */

function getDependencies(): QueryRouteDependencies {
	if (testDependencies) {
		return testDependencies;
	}

	return {
		orchestrator: createQueryOrchestratorService({
			planner: {
				planQuestion: async (question) => {
					const planner = await getDefaultPlannerService();
					return planner.planQuestion(question);
				}
			},
			renderer: getDefaultAnswerRendererService(),
			batchExecutor: createSemanticBatchExecutor({
				validateSemanticQueryRequest,
				executeSemanticQuery
			}),
			buildSemanticNonOkResponse
		})
	};
}

async function getDefaultPlannerService(): Promise<PlannerService> {
	if (defaultPlannerService) {
		return defaultPlannerService;
	}

	if (testDefaultPlannerFactory) {
		defaultPlannerService = await testDefaultPlannerFactory();
		return defaultPlannerService;
	}

	const { createOpenAIPlannerAdapter } = await import('$lib/server/planner/openai-adapter');
	defaultPlannerService = createPlannerService(createOpenAIPlannerAdapter());
	return defaultPlannerService;
}

function getDefaultAnswerRendererService(): AnswerRendererService {
	if (!defaultAnswerRendererService) {
		defaultAnswerRendererService = createDefaultAnswerRendererService();
	}

	return defaultAnswerRendererService;
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
