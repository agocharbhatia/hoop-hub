import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { executeSemanticQuery, validateSemanticQueryRequest } from './query-service';

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
	test('returns ok for supported player ranking queries', async () => {
		const response = await executeSemanticQuery({
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

		assert.equal(response.status, 'ok');
		assert.equal(response.result?.shape, 'ranking');
		assert.equal(response.provenance.legacyIntent, 'league_leaders');
		assert.equal(response.traceId.length > 0, true);
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
});
