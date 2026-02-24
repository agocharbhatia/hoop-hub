import type { MetricId, QueryIntent } from './query-plan';

export type MetricEntityScope = 'player' | 'team';

export type MetricDefinition = {
	id: MetricId;
	aliases: string[];
	allowedIntents: QueryIntent[];
	allowedEntityScopes: MetricEntityScope[];
	requiredSources: string[];
	formula?: string;
};
