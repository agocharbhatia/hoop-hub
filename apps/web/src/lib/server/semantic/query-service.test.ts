import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { resetDataStoreForTests } from '$lib/server/data/store';
import { installSemanticFixtureFetch } from '../../../tests/helpers/semantic-fixture-fetch';
import { executeSemanticQuery, validateSemanticQueryRequest } from './query-service';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

describe('validateSemanticQueryRequest', () => {
	test('accepts a valid player ranking request', () => {
		const result = validateSemanticQueryRequest({
			query: {
				operation: 'rank',
				entity: 'player',
				subject: {},
				metrics: ['ast'],
				filters: {
					season: '2023-24'
				}
			}
		});

		assert.equal(result.ok, true);
	});

	test('rejects invalid window shapes', () => {
		const result = validateSemanticQueryRequest({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['reb'],
				filters: {
					window: {
						type: 'last_n_games',
						n: 0
					}
				}
			}
		});

		assert.equal(result.ok, false);
	});
});

describe('executeSemanticQuery', () => {
	let restoreFetch: (() => void) | null = null;

	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '1';
		resetDataStoreForTests();
		restoreFetch = installSemanticFixtureFetch();
	});

	afterEach(() => {
		restoreFetch?.();
		restoreFetch = null;
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
	});

	test('returns ok for supported player ranking queries', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'rank',
				entity: 'player',
				subject: {},
				metrics: ['ast', 'pts'],
				filters: {
					season: '2023-24'
				}
			}
		});

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'ranking');
		assert.equal(response.result?.rows.length, 20);
		assert.equal(response.provenance.executor, 'semantic_executor');
		assert.equal(response.traceId.length > 0, true);
	});

	test('supports multi-metric player trend rows with window limiting', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['pts', 'reb'],
				filters: {
					season: '2023-24',
					window: {
						type: 'last_n_games',
						n: 4
					}
				},
				limit: 2
			}
		});

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'timeseries');
		assert.equal(response.result?.rows.length, 4);
		assert.equal(response.result?.rows[0]?.metric, 'pts');
	});

	test('supports multi-metric player comparison rows', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'compare',
				entity: 'player',
				subject: {
					names: ['Stephen Curry', 'Damian Lillard']
				},
				metrics: ['pts', 'ast'],
				filters: {
					season: '2023-24'
				}
			}
		});

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'comparison');
		assert.equal(response.result?.rows.length, 4);
	});

	test('supports team ranking rows', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'rank',
				entity: 'team',
				subject: {},
				metrics: ['drtg'],
				filters: {
					season: '2023-24'
				}
			}
		});

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'ranking');
		assert.equal(response.result?.rows.length, 5);
	});

	test('returns clarification_needed when compare requests do not include two players', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'compare',
				entity: 'player',
				subject: {
					names: ['Stephen Curry']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		assert.equal(response.status, 'clarification_needed');
		assert.equal(response.result, null);
		assert.equal(response.warnings[0]?.code, 'compare_requires_two_subjects');
		assert.equal(response.traceId.length > 0, true);
	});

	test('returns coverage_gap instead of a legacy invariant failure for unsupported metrics', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'compare',
				entity: 'player',
				subject: {
					names: ['Stephen Curry', 'Damian Lillard']
				},
				metrics: ['drtg'],
				filters: {}
			}
		});

		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.result, null);
		assert.equal(response.warnings[0]?.code, 'unsupported_metric');
		assert.equal(response.traceId.length > 0, true);
	});

	test('returns coverage_gap for unsupported query shapes', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'lookup',
				entity: 'game',
				subject: {},
				metrics: [],
				filters: {}
			}
		});

		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.warnings[0]?.code, 'unsupported_query_shape');
	});

	test('returns coverage_gap when orderBy is used outside ranking queries', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['pts'],
				filters: {},
				orderBy: {
					metric: 'pts',
					direction: 'asc'
				}
			}
		});

		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.warnings[0]?.code, 'unsupported_order_by');
	});
});
