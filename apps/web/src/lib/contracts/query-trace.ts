import type { Citation, DataFreshnessMode, TraceSourceCall } from './chat';
import type { SemanticQuery, StatsQueryStatus, StatsQueryWarning } from './semantic-query';

export type QueryTraceResponse = {
	traceId: string;
	normalizedQuestion: string;
	status: StatsQueryStatus;
	resolvedQuery: SemanticQuery | null;
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
