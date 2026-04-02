import type { SemanticQuery, StatsQueryWarning } from './semantic-query';

export type PlannerWarningCode =
	| 'unsupported_query_shape'
	| 'unsupported_metric'
	| 'clarification_needed'
	| 'missing_metric';

export type PlannerDecision =
	| {
			type: 'planned';
			query: SemanticQuery;
	  }
	| {
			type: 'coverage_gap' | 'clarification_needed';
			warning: StatsQueryWarning & { code: PlannerWarningCode };
	  };

export type QueryQuestionRequest = {
	question: string;
};
