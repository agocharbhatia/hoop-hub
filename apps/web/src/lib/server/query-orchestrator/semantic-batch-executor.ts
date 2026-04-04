import {
	MAX_BATCH_TOOL_REQUESTS,
	type QueryPlannerToolRequest
} from '$lib/contracts/planner';
import type {
	SemanticQueryRequest,
	StatsQueryResponse
} from '$lib/contracts/semantic-query';
import type {
	QueryAnswerPlannedToolRequest,
	QueryAnswerToolResult
} from '$lib/contracts/answer-response';
import {
	executeSemanticQuery,
	validateSemanticQueryRequest
} from '$lib/server/semantic/query-service';

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type SemanticBatchExecutorInput = {
	question: string;
	toolRequests: QueryPlannerToolRequest[];
};

export type SemanticBatchExecutorResult = {
	plannedToolRequests: QueryAnswerPlannedToolRequest[];
	toolResults: QueryAnswerToolResult[];
	executedStructuredTraceIds: string[];
};

export type SemanticBatchExecutorDependencies = {
	validateSemanticQueryRequest: (request: unknown) => ValidationResult<SemanticQueryRequest>;
	executeSemanticQuery: (request: SemanticQueryRequest) => Promise<StatsQueryResponse>;
};

export type SemanticBatchExecutor = {
	execute(input: SemanticBatchExecutorInput): Promise<SemanticBatchExecutorResult>;
};

/**
 * Executes a bounded internal batch of planned structured requests through the canonical semantic validator and executor.
 */
export function createSemanticBatchExecutor(
	dependencies: SemanticBatchExecutorDependencies = {
		validateSemanticQueryRequest,
		executeSemanticQuery
	}
): SemanticBatchExecutor {
	return {
		async execute(input: SemanticBatchExecutorInput): Promise<SemanticBatchExecutorResult> {
			if (input.toolRequests.length === 0) {
				throw new Error('Planner produced an empty tool batch.');
			}

			if (input.toolRequests.length > MAX_BATCH_TOOL_REQUESTS) {
				throw new Error(`Planner produced more than ${MAX_BATCH_TOOL_REQUESTS} tool requests.`);
			}

			const plannedToolRequests: QueryAnswerPlannedToolRequest[] = [];
			const toolResults: QueryAnswerToolResult[] = [];
			const executedStructuredTraceIds: string[] = [];

			for (const toolRequest of input.toolRequests) {
				const validatedRequest = validatePlannedToolRequest(
					toolRequest,
					input.question,
					dependencies.validateSemanticQueryRequest
				);
				const response = await dependencies.executeSemanticQuery(validatedRequest);
				const plannedToolRequest = {
					toolName: toolRequest.toolName,
					request: validatedRequest
				} satisfies QueryAnswerPlannedToolRequest;

				plannedToolRequests.push(plannedToolRequest);
				toolResults.push({
					...plannedToolRequest,
					response
				});
				executedStructuredTraceIds.push(response.traceId);
			}

			return {
				plannedToolRequests,
				toolResults,
				executedStructuredTraceIds
			};
		}
	};
}

/* Helper functions */

function validatePlannedToolRequest(
	toolRequest: QueryPlannerToolRequest,
	question: string,
	validate: SemanticBatchExecutorDependencies['validateSemanticQueryRequest']
): SemanticQueryRequest {
	if (toolRequest.toolName !== 'stats_query') {
		throw new Error(`Unsupported tool name: ${toolRequest.toolName}`);
	}

	const validated = validate({
		question,
		query: toolRequest.query
	});
	if (!validated.ok) {
		throw new Error(`Planner produced an invalid semantic query: ${validated.error}`);
	}

	return validated.value;
}
