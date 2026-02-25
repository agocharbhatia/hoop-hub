import type { QueryPlan } from './query-plan';

export type Citation = {
	source: string;
	detail?: string;
};

export type ChatQueryStatus = 'ok' | 'unsupported';

export type ChatQueryRequest = {
	sessionId: string;
	message: string;
	clientTs?: string;
};

export type ChatQueryResponse = {
	status: ChatQueryStatus;
	answer: string;
	citations: Citation[];
	traceId: string;
	followups?: string[];
};

export type QueryTraceResponse = {
	traceId: string;
	normalizedQuestion: string;
	queryPlan: QueryPlan;
	executedSources: Citation[];
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

export type ErrorResponse = {
	error: string;
};
