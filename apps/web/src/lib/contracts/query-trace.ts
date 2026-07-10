import type { Citation, DataFreshnessMode, TraceSourceCall } from './chat';
import type { QueryAnswerAgentToolName, QueryAnswerArtifact, QueryAnswerPlannedToolRequest } from './answer-response';
import type { SemanticQuery, StatsQueryStatus, StatsQueryWarning } from './semantic-query';

type QueryTraceShared = {
	traceId: string;
	normalizedQuestion: string;
	status: StatsQueryStatus;
	dataFreshnessMode: DataFreshnessMode;
	sourceCalls: TraceSourceCall[];
	executedSources: Citation[];
	warnings: StatsQueryWarning[];
	computations: {
		formula: string;
		sqlFragment?: string;
		sourceFields: string[];
	}[];
	latencyMs: {
		planning: number;
		retrieval: number;
		compute: number;
		render: number;
		total: number;
	};
	cache: {
		hits: number;
		misses: number;
	};
};

export type SemanticQueryTraceResponse = QueryTraceShared & {
	resolvedQuery: SemanticQuery | null;
};

export type OrchestrationQueryTraceResponse = QueryTraceShared & {
	plannedToolRequests: QueryAnswerPlannedToolRequest[];
	executedStructuredTraceIds: string[];
};

export type DynamicAgentTraceToolCall = {
	toolCallId: string;
	toolName: QueryAnswerAgentToolName;
	request: Record<string, unknown>;
	ok: boolean;
	latencyMs: number;
	error?: string;
};

export type DynamicAgentQueryTraceResponse = QueryTraceShared & {
	runtime: 'dynamic_agent';
	modelUsage: {
		calls: number;
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	toolCalls: DynamicAgentTraceToolCall[];
	artifacts: QueryAnswerArtifact[];
};

export type QueryTraceResponse =
	| SemanticQueryTraceResponse
	| OrchestrationQueryTraceResponse
	| DynamicAgentQueryTraceResponse;
