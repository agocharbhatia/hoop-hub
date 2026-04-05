import type { Citation, DataFreshnessMode, TraceSourceCall } from './chat';
import type { QueryAnswerPlannedToolRequest } from './answer-response';
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

export type QueryTraceResponse = SemanticQueryTraceResponse | OrchestrationQueryTraceResponse;
