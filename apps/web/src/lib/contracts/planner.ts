import type { SemanticQuery, StatsQueryWarning } from './semantic-query';

export const MAX_BATCH_TOOL_REQUESTS = 3;

export type PlannerWarningCode =
	| 'unsupported_query_shape'
	| 'unsupported_metric'
	| 'clarification_needed'
	| 'missing_metric'
	| 'compare_requires_two_subjects';

export type QueryPlannerToolRequest = {
	toolName: 'stats_query';
	query: SemanticQuery;
};

export type BatchPlannerDecision =
	| {
			type: 'planned';
			toolRequests: QueryPlannerToolRequest[];
	  }
	| {
			type: 'coverage_gap' | 'clarification_needed';
			warning: StatsQueryWarning & { code: PlannerWarningCode };
	  };

export type PlannerDecision = BatchPlannerDecision;

export type QueryQuestionRequest = {
	question: string;
};
