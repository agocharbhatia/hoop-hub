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
	planSummary: string[];
	executedSources: Citation[];
	latencyMs: {
		total: number;
	};
};

export type ErrorResponse = {
	error: string;
};
