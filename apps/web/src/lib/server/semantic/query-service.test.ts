import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { resetDataStoreForTests } from '$lib/server/data/store';
import { ensurePlayerDirectoryAvailable, setPlayerDirectoryRefreshLoaderForTests } from '$lib/server/players/player-directory';
import { seedSemanticFixtureCache } from '../../../tests/helpers/seed-semantic-fixture-cache';
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

	test('rejects conflicting structured player ids and names', () => {
		const result = validateSemanticQueryRequest({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					ids: ['201939'],
					names: ['Damian Lillard']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		assert.equal(result.ok, false);
		assert.match(result.error, /same canonical player/i);
	});

	test('rejects deprecated allowLiveFallback request options', () => {
		const result = validateSemanticQueryRequest({
			query: {
				operation: 'rank',
				entity: 'player',
				subject: {},
				metrics: ['ast'],
				filters: {}
			},
			options: {
				allowLiveFallback: false
			}
		});

		assert.equal(result.ok, false);
		assert.match(result.error, /allowLiveFallback has been removed/i);
	});
});

describe('executeSemanticQuery', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
		seedSemanticFixtureCache();
		seedSemanticFixtureCache(new Date('2026-03-25T12:00:00.000Z'));
	});

	afterEach(() => {
		setPlayerDirectoryRefreshLoaderForTests(null);
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

	test('returns canonical resolvedQuery subjects and defaulted filters for id-only trend requests', async () => {
		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'trend',
					entity: 'player',
					subject: {
						ids: ['203999']
					},
					metrics: ['pts'],
					filters: {}
				}
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
	});

	test('returns coverage_gap when no stored query data exists for a required endpoint', async () => {
		assert.equal(ensurePlayerDirectoryAvailable().ok, true);

		const response = await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					ids: ['201939']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		assert.equal(response.status, 'coverage_gap');
		assert.equal(response.result, null);
		assert.equal(response.warnings[0]?.code, 'nightly_data_unavailable');
		assert.equal(response.provenance.dataFreshnessMode, 'nightly');
		assert.equal(response.provenance.sourceCalls[0]?.cacheStatus, 'miss');
	});

	test('canonicalizes exact-name trend requests in resolvedQuery provenance', async () => {
		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'trend',
					entity: 'player',
					subject: {
						names: ['nikola jokic']
					},
					metrics: ['pts'],
					filters: {}
				}
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
	});

	test('canonicalizes curated alias trend requests in resolvedQuery provenance', async () => {
		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'trend',
					entity: 'player',
					subject: {
						names: ['jokic']
					},
					metrics: ['pts'],
					filters: {}
				}
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
	});

	test('returns clarification_needed for ambiguous alias trend requests', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['williams']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		assert.equal(response.status, 'clarification_needed');
		assert.equal(response.result, null);
		assert.equal(response.warnings[0]?.code, 'ambiguous_subject');
		assert.match(response.warnings[0]?.message ?? '', /grant williams/i);
		assert.equal(response.provenance.resolvedQuery, null);
	});

	test('uses the local seeded player directory snapshot when no stored directory exists', async () => {
		const response = await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
	});

	test('falls back to the stored player directory snapshot when refresh fails', async () => {
		await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		setPlayerDirectoryRefreshLoaderForTests(() => {
			throw new Error('refresh unavailable');
		});

		const response = await executeSemanticQuery({
			query: {
				operation: 'trend',
				entity: 'player',
				subject: {
					names: ['Nikola Jokic']
				},
				metrics: ['pts'],
				filters: {}
			}
		});

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['203999'],
			names: ['Nikola Jokic']
		});
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
