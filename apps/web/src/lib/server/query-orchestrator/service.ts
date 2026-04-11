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
					question,
					orchestrationTraceId,
					executedBatch.toolResults,
					executedBatch.status,
					warnings
				);
			}

			const renderStartedAt = performance.now();
			const rendered = await dependencies.renderer.renderAnswer({
				question,
				toolResults: executedBatch.successfulToolResults,
				warnings
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

	return buildNonOkAnswerResponse(question, traceId, [], decision.type, response.warnings);
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
	question: string,
	traceId: string,
	toolResults: QueryAnswerToolResult[],
	status: Exclude<StatsQueryResponse['status'], 'ok'>,
	warnings: StatsQueryResponse['warnings']
): QueryAnswerResponse {
	return {
		status,
		answer: buildNonOkAnswerText(question, status, warnings),
		artifacts: [],
		toolResults,
		citations: collectCitations(toolResults),
		warnings,
		traceId
	};
}

function buildNonOkAnswerText(
	question: string,
	status: Exclude<StatsQueryResponse['status'], 'ok'>,
	warnings: StatsQueryResponse['warnings']
): string {
	const primaryWarning = warnings[0];
	const normalizedQuestion = question.trim();
	if (!primaryWarning) {
		return `I couldn't answer "${normalizedQuestion}" from the current stats slice.`;
	}

	if (primaryWarning.code === 'nightly_data_unavailable') {
		if (/not final yet/i.test(primaryWarning.message)) {
			return `I couldn't confirm "${normalizedQuestion}" because the stored nightly scoreboard for that game date is still marked non-final. Try rerunning the nightly bootstrap for the current slate date, or ask again after the nightly refresh completes.`;
		}

		return `I couldn't fully answer "${normalizedQuestion}" because the nightly snapshot is missing some of the required data. Try rerunning the nightly bootstrap, or narrow the question to one team and one exact date or date range.`;
	}

	if (
		primaryWarning.code === 'unsupported_query_shape' &&
		/Single-event team game queries require either one exact date or a supported gameStatus\./i.test(
			primaryWarning.message
		)
	) {
		return `I couldn't answer "${normalizedQuestion}" as written because this stats slice only supports a team's next game, a recent final result, one exact date, or an explicit date range. Try "Did the Raptors win last night?" or "Show the Raptors games from April 1, 2026 to April 5, 2026."`;
	}

	if (status === 'clarification_needed') {
		return `I need a narrower version of "${normalizedQuestion}" before I can answer it. ${primaryWarning.message}`;
	}

	return `I couldn't answer "${normalizedQuestion}" with the current stats slice. ${primaryWarning.message}`;
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
