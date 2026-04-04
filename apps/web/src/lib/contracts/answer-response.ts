import type { Citation } from './chat';
import type {
	SemanticQueryRequest,
	StatsQueryResponse,
	StatsQueryRow,
	StatsQueryStatus,
	StatsQueryWarning
} from './semantic-query';

export type QueryAnswerArtifact =
	| {
			type: 'table';
			shape: NonNullable<StatsQueryResponse['result']>['shape'];
			columns: string[];
			rows: StatsQueryRow[];
	  }
	| {
			type: 'text';
			text: string;
	  };

export type QueryAnswerPlannedToolRequest = {
	toolName: 'stats_query';
	request: SemanticQueryRequest;
};

export type QueryAnswerToolResult = QueryAnswerPlannedToolRequest & {
	response: StatsQueryResponse;
};

export type QueryAnswerResponse = {
	status: StatsQueryStatus;
	answer: string;
	artifacts: QueryAnswerArtifact[];
	toolResults: QueryAnswerToolResult[];
	citations: Citation[];
	warnings: StatsQueryWarning[];
	traceId: string;
};
