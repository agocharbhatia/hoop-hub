import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SemanticQuery } from '$lib/contracts/semantic-query';
import { createPlannerService, type PlannerAdapter } from './service';

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
