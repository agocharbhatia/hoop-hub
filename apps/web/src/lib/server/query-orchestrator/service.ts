import type {
	QueryAnswerResponse,
	QueryAnswerToolResult
} from '$lib/contracts/answer-response';
import type { BatchPlannerDecision } from '$lib/contracts/planner';
import type { SemanticQuery, StatsQueryResponse } from '$lib/contracts/semantic-query';
import type { AnswerRendererService } from '$lib/server/answer-renderer/service';
import type { PlannerService } from '$lib/server/planner/service';
import { saveOrchestrationTrace } from '$lib/server/semantic/trace-store';
import type {
	SemanticBatchExecutor,
	SemanticBatchExecutorResult
} from './semantic-batch-executor';

export type QueryOrchestratorDependencies = {
	planner: PlannerService;
	renderer: AnswerRendererService;
	batchExecutor: SemanticBatchExecutor;
	buildSemanticNonOkResponse: (
		type: 'clarification_needed' | 'coverage_gap',
		question: string,
		warning: StatsQueryResponse['warnings'][number],
		resolvedQuery: SemanticQuery | null,
		planningLatencyMs?: number
	) => StatsQueryResponse;
};

export type QueryOrchestratorService = {
	answerQuestion(question: string): Promise<QueryAnswerResponse>;
};

/**
 * Orchestrates the answer-first `/api/query` flow: batch planning, internal tool execution, rendering, and orchestration traces.
 */
export function createQueryOrchestratorService(
	dependencies: QueryOrchestratorDependencies
): QueryOrchestratorService {
	return {
		async answerQuestion(question: string): Promise<QueryAnswerResponse> {
			const orchestrationTraceId = crypto.randomUUID();
			const planningStartedAt = performance.now();
			const decision = await dependencies.planner.planQuestion(question);
			const planningLatencyMs = Math.round(performance.now() - planningStartedAt);

			if (decision.type !== 'planned') {
				return buildPlannedNonOkResponse(
					orchestrationTraceId,
					question,
					decision,
					planningLatencyMs,
					dependencies.buildSemanticNonOkResponse
				);
			}

			const executedBatch = await dependencies.batchExecutor.execute({
				question,
				toolRequests: decision.toolRequests
			});
			const warnings = [...(decision.warnings ?? []), ...executedBatch.warnings];

			if (executedBatch.status !== 'ok') {
				saveQueryOrchestrationTrace(
					orchestrationTraceId,
					question,
					executedBatch.status,
					executedBatch,
					warnings,
					planningLatencyMs,
					0
				);
				return buildNonOkAnswerResponse(
					orchestrationTraceId,
					executedBatch.toolResults,
					executedBatch.status,
					warnings
				);
			}

			const renderStartedAt = performance.now();
			const rendered = await dependencies.renderer.renderAnswer({
				question,
				toolResults: executedBatch.successfulToolResults
			});
			const renderLatencyMs = Math.round(performance.now() - renderStartedAt);
			const citations = collectCitations(executedBatch.successfulToolResults);

			saveQueryOrchestrationTrace(
				orchestrationTraceId,
				question,
				'ok',
				executedBatch,
				warnings,
				planningLatencyMs,
				renderLatencyMs
			);

			return {
				status: 'ok',
				answer: rendered.answer,
				artifacts: rendered.artifacts,
				toolResults: executedBatch.toolResults,
				citations,
				warnings,
				traceId: orchestrationTraceId
			} satisfies QueryAnswerResponse;
		}
	};
}

/* Helper functions */

function buildPlannedNonOkResponse(
	traceId: string,
	question: string,
	decision: Exclude<BatchPlannerDecision, { type: 'planned' }>,
	planningLatencyMs: number,
	buildSemanticNonOkResponse: QueryOrchestratorDependencies['buildSemanticNonOkResponse']
): QueryAnswerResponse {
	const response = buildSemanticNonOkResponse(
		decision.type,
		question,
		decision.warning,
		null,
		planningLatencyMs
	);

	saveOrchestrationTrace({
		traceId,
		normalizedQuestion: question,
		status: response.status,
		plannedToolRequests: [],
		executedStructuredTraceIds: [],
		warnings: response.warnings,
		computations: [],
		latencyMs: {
			planning: planningLatencyMs,
			render: 0
		}
	});

	return buildNonOkAnswerResponse(traceId, [], decision.type, response.warnings);
}

function saveQueryOrchestrationTrace(
	traceId: string,
	question: string,
	status: StatsQueryResponse['status'],
	executedBatch: SemanticBatchExecutorResult,
	warnings: StatsQueryResponse['warnings'],
	planningLatencyMs: number,
	renderLatencyMs: number
): void {
	saveOrchestrationTrace({
		traceId,
		normalizedQuestion: question,
		status,
		plannedToolRequests: executedBatch.plannedToolRequests,
		executedStructuredTraceIds: executedBatch.executedStructuredTraceIds,
		warnings,
		computations: [],
		latencyMs: {
			planning: planningLatencyMs,
			render: renderLatencyMs
		}
	});
}

function buildNonOkAnswerResponse(
	traceId: string,
	toolResults: QueryAnswerToolResult[],
	status: Exclude<StatsQueryResponse['status'], 'ok'>,
	warnings: StatsQueryResponse['warnings']
): QueryAnswerResponse {
	return {
		status,
		answer: warnings[0]?.message ?? 'Unable to process this query.',
		artifacts: [],
		toolResults,
		citations: collectCitations(toolResults),
		warnings,
		traceId
	};
}

function collectCitations(toolResults: QueryAnswerToolResult[]): QueryAnswerResponse['citations'] {
	const seen = new Set<string>();
	const citations: QueryAnswerResponse['citations'] = [];

	for (const toolResult of toolResults) {
		for (const citation of toolResult.response.citations) {
			const key = JSON.stringify(citation);
			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			citations.push(citation);
		}
	}

	return citations;
}
