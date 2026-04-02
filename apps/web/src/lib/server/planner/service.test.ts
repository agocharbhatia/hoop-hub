import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SemanticQuery } from '$lib/contracts/semantic-query';
import { createPlannerService, type PlannerAdapter } from './service';

/* Helper functions */

function buildRankingQuery(metric: string): SemanticQuery {
	return {
		operation: 'rank',
		entity: 'player',
		subject: {},
		metrics: [metric],
		filters: {
			season: '2023-24',
			seasonType: null,
			window: null,
			dateFrom: null,
			dateTo: null
		},
		orderBy: {
			metric,
			direction: 'desc'
		},
		limit: 10,
		outputMode: 'table'
	};
}

function buildTrendQuery(metric: string, n: number): SemanticQuery {
	return {
		operation: 'trend',
		entity: 'player',
		subject: {
			names: ['Jokic']
		},
		metrics: [metric],
		filters: {
			season: null,
			seasonType: null,
			window: {
				type: 'last_n_games',
				n
			},
			dateFrom: null,
			dateTo: null
		},
		orderBy: null,
		limit: null,
		outputMode: 'timeseries'
	};
}

function buildComparisonQuery(subjectNames: string[], metric: string): SemanticQuery {
	return {
		operation: 'compare',
		entity: 'player',
		subject: {
			names: subjectNames
		},
		metrics: [metric],
		filters: {
			season: '2023-24',
			seasonType: null,
			window: null,
			dateFrom: null,
			dateTo: null
		},
		orderBy: null,
		limit: null,
		outputMode: 'comparison'
	};
}

function createAdapter(output: unknown): PlannerAdapter {
	return {
		async planQuestion() {
			return output;
		}
	};
}

describe('createPlannerService', () => {
	test('returns planned decisions for supported player rankings', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				query: buildRankingQuery('ast')
			})
		);

		const decision = await planner.planQuestion('Who averaged the most assists in 2023-24?');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.query.operation, 'rank');
		assert.equal(decision.query.entity, 'player');
		assert.deepEqual(decision.query.metrics, ['ast']);
	});

	test('returns planned decisions for scoring-language player trends and preserves rolling windows', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				query: buildTrendQuery('pts', 5)
			})
		);

		const decision = await planner.planQuestion('How has Jokic scored over his last 5?');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.query.operation, 'trend');
		assert.equal(decision.query.entity, 'player');
		assert.deepEqual(decision.query.metrics, ['pts']);
		assert.deepEqual(decision.query.filters.window, {
			type: 'last_n_games',
			n: 5
		});
	});

	test('returns planned decisions for player comparisons and preserves subject order', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				query: buildComparisonQuery(['Damian Lillard', 'Stephen Curry'], 'ast')
			})
		);

		const decision = await planner.planQuestion('Compare Damian Lillard vs Stephen Curry by assists in 2023-24');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.equal(decision.query.operation, 'compare');
		assert.equal(decision.query.entity, 'player');
		assert.deepEqual(decision.query.subject.names, ['Damian Lillard', 'Stephen Curry']);
		assert.deepEqual(decision.query.metrics, ['ast']);
		assert.equal(decision.query.outputMode, 'comparison');
	});

	test('returns planned decisions for compare asks without a metric using safe default pts', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				query: buildComparisonQuery(['Stephen Curry', 'Damian Lillard'], 'pts')
			})
		);

		const decision = await planner.planQuestion('Compare Stephen Curry vs Damian Lillard in 2023-24');

		assert.equal(decision.type, 'planned');
		if (decision.type !== 'planned') {
			throw new Error('Expected planned decision.');
		}
		assert.deepEqual(decision.query.metrics, ['pts']);
	});

	test('returns typed clarification_needed decisions for vague trend asks with no metric', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'clarification_needed',
				warning: {
					code: 'missing_metric',
					message: 'Player trend questions need a metric like points, assists, or rebounds.'
				}
			})
		);

		const decision = await planner.planQuestion('Show me Jokic over his last 5');

		assert.equal(decision.type, 'clarification_needed');
		if (decision.type !== 'clarification_needed') {
			throw new Error('Expected clarification_needed decision.');
		}
		assert.equal(decision.warning.code, 'missing_metric');
	});

	test('returns typed clarification_needed decisions when a comparison does not include two subjects', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'clarification_needed',
				warning: {
					code: 'compare_requires_two_subjects',
					message: 'Player comparisons require exactly two player names in this slice.'
				}
			})
		);

		const decision = await planner.planQuestion('Compare Steph by points in 2023-24');

		assert.equal(decision.type, 'clarification_needed');
		if (decision.type !== 'clarification_needed') {
			throw new Error('Expected clarification_needed decision.');
		}
		assert.equal(decision.warning.code, 'compare_requires_two_subjects');
	});

	test('returns typed coverage gaps for unsupported asks', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'coverage_gap',
				warning: {
					code: 'unsupported_query_shape',
					message: 'Predictions are not supported in this slice.'
				}
			})
		);

		const decision = await planner.planQuestion('Who wins the title this year?');

		assert.equal(decision.type, 'coverage_gap');
		if (decision.type !== 'coverage_gap') {
			throw new Error('Expected coverage_gap decision.');
		}
		assert.equal(decision.warning.code, 'unsupported_query_shape');
	});

	test('throws for invalid structured planner output', async () => {
		const planner = createPlannerService(
			createAdapter({
				type: 'planned',
				query: {
					operation: 'trend',
					entity: 'player',
					subject: {},
					metrics: ['pts'],
					filters: {}
				}
			})
		);

		await assert.rejects(
			async () => {
				await planner.planQuestion('Who averaged the most points?');
			},
			/error/i
		);
	});
});
