import type {
	SemanticQuery,
	SemanticQueryEntity,
	SemanticQueryOperation,
	SemanticQueryOutputMode
} from '$lib/contracts/semantic-query';
import type { QueryIntent } from '$lib/contracts/query-plan';
import { listMetricDefinitions } from '$lib/server/metrics/registry';

export type SemanticSubjectRuleKind = 'none' | 'exactly_one' | 'exactly_two' | 'zero_or_one';

export type SemanticCapabilitySubjectRule = {
	operation: SemanticQueryOperation;
	entity: SemanticQueryEntity;
	kind: SemanticSubjectRuleKind;
};

export type PublicSemanticMetricCapability = {
	id: string;
	operations: SemanticQueryOperation[];
	entities: SemanticQueryEntity[];
};

export type PublicSemanticFilterCapability = {
	id: 'conference' | 'division' | 'gameStatus';
	operations: SemanticQueryOperation[];
	entities: SemanticQueryEntity[];
	values: string[];
};

export type PublicSemanticQueryShapePlanning = {
	orderBy: 'none' | 'same_metric_desc' | 'same_metric_asc';
	defaultLimit: number | null;
	supportsWindow: boolean;
};

export type PublicSemanticQueryShapeCapability = {
	operation: SemanticQueryOperation;
	entity: SemanticQueryEntity;
	outputModes: SemanticQueryOutputMode[];
	subjectRule: SemanticSubjectRuleKind;
	metrics: string[];
	planning: PublicSemanticQueryShapePlanning;
};

export type PublicSemanticCapabilities = {
	operations: SemanticQueryOperation[];
	entities: SemanticQueryEntity[];
	outputModes: SemanticQueryOutputMode[];
	seasons: {
		supported: string[];
		default: string;
	};
	seasonTypes: {
		supported: string[];
		default: string;
	};
	metrics: PublicSemanticMetricCapability[];
	filters: PublicSemanticFilterCapability[];
	resultCompleteness: {
		fields: Array<'coverageStatus' | 'requestedCount' | 'returnedCount'>;
		coverageStatuses: Array<'complete' | 'season_exhausted' | 'partial_materialized'>;
	};
	subjectRules: SemanticCapabilitySubjectRule[];
	queryShapes: PublicSemanticQueryShapeCapability[];
};

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

type SupportedShape = {
	operation: SemanticQueryOperation;
	entity: SemanticQueryEntity;
	outputModes: SemanticQueryOutputMode[];
	subjectRule: SemanticSubjectRuleKind;
	planning: PublicSemanticQueryShapePlanning;
};

type SupportedShapeKey =
	| 'lookup/player'
	| 'lookup/team'
	| 'rank/player'
	| 'trend/player'
	| 'compare/player'
	| 'rank/team'
	| 'standings/team'
	| 'game/team';

type IntentBackedShapeKey = Exclude<SupportedShapeKey, 'standings/team' | 'game/team'>;

type SupportedMetricDefinition = {
	id: string;
	operations: SemanticQueryOperation[];
	entities: SemanticQueryEntity[];
};

const SUPPORTED_SHAPES: SupportedShape[] = [
	{
		operation: 'lookup',
		entity: 'player',
		outputModes: ['table'],
		subjectRule: 'exactly_one',
		planning: {
			orderBy: 'none',
			defaultLimit: null,
			supportsWindow: false
		}
	},
	{
		operation: 'lookup',
		entity: 'team',
		outputModes: ['table'],
		subjectRule: 'exactly_one',
		planning: {
			orderBy: 'none',
			defaultLimit: null,
			supportsWindow: false
		}
	},
	{
		operation: 'rank',
		entity: 'player',
		outputModes: ['table'],
		subjectRule: 'none',
		planning: {
			orderBy: 'same_metric_desc',
			defaultLimit: 10,
			supportsWindow: false
		}
	},
	{
		operation: 'trend',
		entity: 'player',
		outputModes: ['timeseries'],
		subjectRule: 'exactly_one',
		planning: {
			orderBy: 'none',
			defaultLimit: null,
			supportsWindow: true
		}
	},
	{
		operation: 'compare',
		entity: 'player',
		outputModes: ['comparison'],
		subjectRule: 'exactly_two',
		planning: {
			orderBy: 'none',
			defaultLimit: null,
			supportsWindow: false
		}
	},
	{
		operation: 'rank',
		entity: 'team',
		outputModes: ['table'],
		subjectRule: 'zero_or_one',
		planning: {
			orderBy: 'same_metric_asc',
			defaultLimit: 10,
			supportsWindow: false
		}
	},
	{
		operation: 'standings',
		entity: 'team',
		outputModes: ['table'],
		subjectRule: 'zero_or_one',
		planning: {
			orderBy: 'same_metric_desc',
			defaultLimit: 10,
			supportsWindow: false
		}
	},
	{
		operation: 'game',
		entity: 'team',
		outputModes: ['table'],
		subjectRule: 'exactly_one',
		planning: {
			orderBy: 'none',
			defaultLimit: 1,
			supportsWindow: false
		}
	}
] as const;

const SUPPORTED_SEASONS = ['current', '2023-24'] as const;
const SUPPORTED_SEASON_TYPES = ['Regular Season'] as const;

const INTENT_BY_SHAPE = new Map<IntentBackedShapeKey, QueryIntent>(
	[
		['lookup/player', 'player_lookup'],
		['lookup/team', 'team_lookup'],
		['rank/player', 'league_leaders'],
		['trend/player', 'player_trend'],
		['compare/player', 'player_compare'],
		['rank/team', 'team_ranking']
	] as const
);

const STANDINGS_METRIC_DEFINITIONS = [
	{ id: 'conference_rank', operations: ['standings'], entities: ['team'] },
	{ id: 'seed', operations: ['standings'], entities: ['team'] },
	{ id: 'wins', operations: ['standings'], entities: ['team'] },
	{ id: 'losses', operations: ['standings'], entities: ['team'] },
	{ id: 'win_pct', operations: ['standings'], entities: ['team'] },
	{ id: 'games_back', operations: ['standings'], entities: ['team'] },
	{ id: 'streak', operations: ['standings'], entities: ['team'] }
] satisfies SupportedMetricDefinition[];

const GAME_METRIC_DEFINITIONS = [
	{ id: 'game_date', operations: ['game'], entities: ['team'] },
	{ id: 'game_status', operations: ['game'], entities: ['team'] },
	{ id: 'opponent_team', operations: ['game'], entities: ['team'] },
	{ id: 'team_score', operations: ['game'], entities: ['team'] },
	{ id: 'opponent_score', operations: ['game'], entities: ['team'] },
	{ id: 'result', operations: ['game'], entities: ['team'] }
] satisfies SupportedMetricDefinition[];

const SHAPE_SPECIFIC_METRIC_DEFINITIONS: SupportedMetricDefinition[] = [
	...STANDINGS_METRIC_DEFINITIONS,
	...GAME_METRIC_DEFINITIONS
];

const SUPPORTED_FILTERS: PublicSemanticFilterCapability[] = [
	{
		id: 'conference',
		operations: ['standings'],
		entities: ['team'],
		values: ['East', 'West']
	},
	{
		id: 'division',
		operations: ['standings'],
		entities: ['team'],
		values: ['Atlantic', 'Central', 'Southeast', 'Northwest', 'Pacific', 'Southwest']
	},
	{
		id: 'gameStatus',
		operations: ['game'],
		entities: ['team'],
		values: ['upcoming', 'final', 'any']
	}
];

function getShapeKey(operation: SemanticQueryOperation, entity: SemanticQueryEntity): SupportedShapeKey | null {
	const key = `${operation}/${entity}`;
	return key === 'lookup/player' ||
		key === 'lookup/team' ||
		key === 'rank/player' ||
		key === 'trend/player' ||
		key === 'compare/player' ||
		key === 'rank/team' ||
		key === 'standings/team' ||
		key === 'game/team'
		? key
		: null;
}

function getSupportedShape(
	operation: SemanticQueryOperation,
	entity: SemanticQueryEntity
): SupportedShape | undefined {
	return SUPPORTED_SHAPES.find((shape) => shape.operation === operation && shape.entity === entity);
}

function countStructuredSubjects(subject: SemanticQuery['subject']): number {
	const names = subject.names ?? [];
	const ids = subject.ids ?? [];
	return Math.max(names.length, ids.length);
}

function getIntentForShape(shape: Pick<SupportedShape, 'operation' | 'entity'>) {
	const shapeKey = getShapeKey(shape.operation, shape.entity);
	if (!shapeKey || !INTENT_BY_SHAPE.has(shapeKey as IntentBackedShapeKey)) {
		return undefined;
	}

	return INTENT_BY_SHAPE.get(shapeKey as IntentBackedShapeKey);
}

function getSupportedMetricIdsForShape(shape: Pick<SupportedShape, 'operation' | 'entity'>): string[] {
	const shapeSpecificMetrics = SHAPE_SPECIFIC_METRIC_DEFINITIONS.filter(
		(metric) => metric.operations.includes(shape.operation) && metric.entities.includes(shape.entity)
	).map((metric) => metric.id);
	if (shapeSpecificMetrics.length > 0) {
		return shapeSpecificMetrics;
	}

	const shapeIntent = getIntentForShape(shape);
	if (!shapeIntent) {
		return [];
	}

	return listMetricDefinitions()
		.filter(
			(metric) =>
				metric.allowedIntents.includes(shapeIntent) &&
				metric.allowedEntityScopes.includes(shape.entity as 'player' | 'team')
		)
		.map((metric) => metric.id);
}

function validateStructuredSubjectRule(
	shape: SupportedShape,
	subject: SemanticQuery['subject']
): ValidationResult<SemanticQuery['subject']> {
	const subjectCount = countStructuredSubjects(subject);

	if (shape.subjectRule === 'none' && subjectCount !== 0) {
		return {
			ok: false,
			error: 'query.subject must be empty for this supported query shape.'
		};
	}

	if (shape.subjectRule === 'exactly_one' && subjectCount !== 1) {
		return {
			ok: false,
			error: 'query.subject must include exactly one subject for this supported query shape.'
		};
	}

	if (shape.subjectRule === 'exactly_two' && subjectCount !== 2) {
		return {
			ok: false,
			error: 'query.subject must include exactly two subjects for this supported query shape.'
		};
	}

	if (shape.subjectRule === 'zero_or_one' && subjectCount > 1) {
		return {
			ok: false,
			error: 'query.subject must include at most one subject for this supported query shape.'
		};
	}

	return {
		ok: true,
		value: subject
	};
}

export function getPublicSemanticCapabilities(): PublicSemanticCapabilities {
	const operations = Array.from(new Set(SUPPORTED_SHAPES.map((shape) => shape.operation)));
	const entities = Array.from(new Set(SUPPORTED_SHAPES.map((shape) => shape.entity)));
	const outputModes = Array.from(
		new Set(SUPPORTED_SHAPES.flatMap((shape) => shape.outputModes))
	);

	const metrics = listMetricDefinitions()
		.map((metric) => {
			const supportedOperations = new Set<SemanticQueryOperation>();
			const supportedEntities = new Set<SemanticQueryEntity>();

			for (const shape of SUPPORTED_SHAPES) {
				const intent = getIntentForShape(shape);
				if (!intent) {
					continue;
				}

				if (
					metric.allowedIntents.includes(intent) &&
					metric.allowedEntityScopes.includes(shape.entity as 'player' | 'team')
				) {
					supportedOperations.add(shape.operation);
					supportedEntities.add(shape.entity);
				}
			}

			if (supportedOperations.size === 0 || supportedEntities.size === 0) {
				return null;
			}

			return {
				id: metric.id,
				operations: Array.from(supportedOperations),
				entities: Array.from(supportedEntities)
			} satisfies PublicSemanticMetricCapability;
		})
		.filter((metric): metric is PublicSemanticMetricCapability => metric !== null);
	const mergedMetrics = new Map<string, PublicSemanticMetricCapability>();

	for (const metric of metrics) {
		mergedMetrics.set(metric.id, {
			id: metric.id,
			operations: [...metric.operations],
			entities: [...metric.entities]
		});
	}

	for (const metric of SHAPE_SPECIFIC_METRIC_DEFINITIONS) {
		const existing = mergedMetrics.get(metric.id);
		if (existing) {
			existing.operations = Array.from(new Set([...existing.operations, ...metric.operations]));
			existing.entities = Array.from(new Set([...existing.entities, ...metric.entities]));
			continue;
		}

		mergedMetrics.set(metric.id, {
			id: metric.id,
			operations: [...metric.operations],
			entities: [...metric.entities]
		});
	}

	return {
		operations,
		entities,
		outputModes,
		seasons: {
			supported: [...SUPPORTED_SEASONS],
			default: 'current'
		},
		seasonTypes: {
			supported: [...SUPPORTED_SEASON_TYPES],
			default: 'Regular Season'
		},
		metrics: Array.from(mergedMetrics.values()),
		filters: SUPPORTED_FILTERS.map((filter) => ({
			id: filter.id,
			operations: [...filter.operations],
			entities: [...filter.entities],
			values: [...filter.values]
		})),
		resultCompleteness: {
			fields: ['coverageStatus', 'requestedCount', 'returnedCount'],
			coverageStatuses: ['complete', 'season_exhausted', 'partial_materialized']
		},
		subjectRules: SUPPORTED_SHAPES.map((shape) => ({
			operation: shape.operation,
			entity: shape.entity,
			kind: shape.subjectRule
		})),
		queryShapes: SUPPORTED_SHAPES.map((shape) => ({
			operation: shape.operation,
			entity: shape.entity,
			outputModes: [...shape.outputModes],
			subjectRule: shape.subjectRule,
			metrics: getSupportedMetricIdsForShape(shape),
			planning: {
				...shape.planning
			}
		}))
	};
}

export function isSupportedSemanticMetric(
	operation: SemanticQueryOperation,
	entity: SemanticQueryEntity,
	metricId: string
): boolean {
	if (
		SHAPE_SPECIFIC_METRIC_DEFINITIONS.some(
			(metric) => metric.id === metricId && metric.operations.includes(operation) && metric.entities.includes(entity)
		)
	) {
		return true;
	}

	const shapeIntent = getIntentForShape({ operation, entity });
	if (!shapeIntent) {
		return false;
	}

	return listMetricDefinitions().some(
		(metric) =>
			metric.id === metricId &&
			metric.allowedIntents.includes(shapeIntent) &&
			metric.allowedEntityScopes.includes(entity as 'player' | 'team')
	);
}

export function validateSemanticCapabilityQueryShape(
	query: Pick<SemanticQuery, 'operation' | 'entity' | 'subject' | 'metrics' | 'filters' | 'outputMode'>
): ValidationResult<typeof query> {
	const capabilities = getPublicSemanticCapabilities();

	if (!capabilities.operations.includes(query.operation)) {
		return { ok: false, error: 'query.operation is required and must be a supported semantic operation.' };
	}

	if (!capabilities.entities.includes(query.entity)) {
		return { ok: false, error: 'query.entity is required and must be a supported semantic entity.' };
	}

	const supportedShape = getSupportedShape(query.operation, query.entity);
	if (!supportedShape) {
		return { ok: false, error: 'query.operation and query.entity must describe a supported semantic query shape.' };
	}

	const subjectValidation = validateStructuredSubjectRule(supportedShape, query.subject);
	if (!subjectValidation.ok) {
		return subjectValidation;
	}

	if (query.metrics.length === 0) {
		return { ok: false, error: 'query.metrics must contain at least one supported metric.' };
	}

	for (const metricId of query.metrics) {
		if (!isSupportedSemanticMetric(query.operation, query.entity, metricId)) {
			return {
				ok: false,
				error: `Metric '${metricId}' is not supported for ${query.operation}/${query.entity}.`
			};
		}
	}

	if (query.outputMode !== undefined && query.outputMode !== null && !supportedShape.outputModes.includes(query.outputMode)) {
		return {
			ok: false,
			error: `query.outputMode must be one of ${supportedShape.outputModes.map((mode) => `'${mode}'`).join(', ')} for this supported query shape.`
		};
	}

	if (
		query.filters.season !== undefined &&
		query.filters.season !== null &&
		!SUPPORTED_SEASONS.includes(query.filters.season as (typeof SUPPORTED_SEASONS)[number])
	) {
		return {
			ok: false,
			error: `query.filters.season must be omitted for current season or one of ${SUPPORTED_SEASONS.filter((season) => season !== 'current')
				.map((season) => `'${season}'`)
				.join(', ')}.`
		};
	}

	if (
		query.filters.seasonType !== undefined &&
		query.filters.seasonType !== null &&
		!SUPPORTED_SEASON_TYPES.includes(query.filters.seasonType as (typeof SUPPORTED_SEASON_TYPES)[number])
	) {
		return {
			ok: false,
			error: `query.filters.seasonType must be one of ${SUPPORTED_SEASON_TYPES.map((seasonType) => `'${seasonType}'`).join(', ')}.`
		};
	}

	if (query.filters.conference !== undefined && query.filters.conference !== null) {
		if (query.operation !== 'standings' || query.entity !== 'team') {
			return {
				ok: false,
				error: 'query.filters.conference is only supported for standings/team.'
			};
		}

		if (query.filters.conference !== 'East' && query.filters.conference !== 'West') {
			return {
				ok: false,
				error: "query.filters.conference must be 'East' or 'West'."
			};
		}
	}

	if (query.filters.division !== undefined && query.filters.division !== null) {
		if (query.operation !== 'standings' || query.entity !== 'team') {
			return {
				ok: false,
				error: 'query.filters.division is only supported for standings/team.'
			};
		}

		if (!SUPPORTED_FILTERS[1].values.includes(query.filters.division)) {
			return {
				ok: false,
				error: `query.filters.division must be one of ${SUPPORTED_FILTERS[1].values.map((value) => `'${value}'`).join(', ')}.`
			};
		}
	}

	if (query.filters.gameStatus !== undefined && query.filters.gameStatus !== null) {
		if (query.operation !== 'game' || query.entity !== 'team') {
			return {
				ok: false,
				error: 'query.filters.gameStatus is only supported for game/team.'
			};
		}

		if (!SUPPORTED_FILTERS[2].values.includes(query.filters.gameStatus)) {
			return {
				ok: false,
				error: "query.filters.gameStatus must be one of 'upcoming', 'final', 'any'."
			};
		}
	}

	return { ok: true, value: query };
}
