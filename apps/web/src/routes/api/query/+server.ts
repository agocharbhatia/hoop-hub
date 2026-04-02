import { json } from '@sveltejs/kit';
import type { PlannerService } from '$lib/server/planner/service';
import { createPlannerService } from '$lib/server/planner/service';
import {
	buildSemanticNonOkResponse,
	executeSemanticQuery,
	validateSemanticQueryRequest
} from '$lib/server/semantic/query-service';
import type { RequestHandler } from './$types';

type QueryRouteDependencies = {
	planner: PlannerService;
	executeSemanticQuery: typeof executeSemanticQuery;
	validateSemanticQueryRequest: typeof validateSemanticQueryRequest;
	buildSemanticNonOkResponse: typeof buildSemanticNonOkResponse;
};

let testDependencies: QueryRouteDependencies | null = null;
let defaultPlannerService: PlannerService | null = null;
let testDefaultPlannerFactory: (() => Promise<PlannerService>) | null = null;

/**
 * Allows route tests to isolate planner and executor behavior without relying on live model calls.
 */
export function _setQueryRouteDependenciesForTests(
	dependencies:
		| {
				planQuestion: PlannerService['planQuestion'];
				executeSemanticQuery: typeof executeSemanticQuery;
		  }
		| null
): void {
	if (!dependencies) {
		testDependencies = null;
		return;
	}

	testDependencies = {
		planner: {
			planQuestion: dependencies.planQuestion
		},
		executeSemanticQuery: dependencies.executeSemanticQuery,
		validateSemanticQueryRequest,
		buildSemanticNonOkResponse
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
		const planningStartedAt = performance.now();
		const decision = await dependencies.planner.planQuestion(parsed.value.question);
		const planningLatencyMs = Math.round(performance.now() - planningStartedAt);

		if (decision.type !== 'planned') {
			const result = dependencies.buildSemanticNonOkResponse(
				decision.type,
				parsed.value.question,
				decision.warning,
				null,
				planningLatencyMs
			);
			return json(result, { status: 200 });
		}

		const validated = dependencies.validateSemanticQueryRequest({
			question: parsed.value.question,
			query: decision.query
		});
		if (!validated.ok) {
			throw new Error(`Planner produced an invalid semantic query: ${validated.error}`);
		}

		const result = await dependencies.executeSemanticQuery(validated.value);
		return json(result, { status: 200 });
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
		planner: {
			planQuestion: async (question) => {
				const planner = await getDefaultPlannerService();
				return planner.planQuestion(question);
			}
		},
		executeSemanticQuery,
		validateSemanticQueryRequest,
		buildSemanticNonOkResponse
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
