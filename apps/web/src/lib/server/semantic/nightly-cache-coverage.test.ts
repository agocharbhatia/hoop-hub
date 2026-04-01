import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { resetDataStoreForTests } from '$lib/server/data/store';
import { seedSemanticFixtureCache } from '../../../tests/helpers/seed-semantic-fixture-cache';
import { executeSemanticQuery } from './query-service';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

describe('semantic nightly cache coverage', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
		seedSemanticFixtureCache();
		seedSemanticFixtureCache(new Date('2026-03-25T12:00:00.000Z'));
	});

	afterEach(() => {
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
	});

	test('seeded nightly cache covers every supported semantic endpoint shape', async () => {
		const responses = await Promise.all([
			executeSemanticQuery({
				query: {
					operation: 'rank',
					entity: 'player',
					subject: {},
					metrics: ['ast'],
					filters: {
						season: '2023-24'
					}
				}
			}),
			executeSemanticQuery(
				{
					query: {
						operation: 'trend',
						entity: 'player',
						subject: {
							names: ['Nikola Jokic']
						},
						metrics: ['pts'],
						filters: {}
					}
				},
				new Date('2026-03-25T12:00:00.000Z')
			),
			executeSemanticQuery(
				{
					query: {
						operation: 'compare',
						entity: 'player',
						subject: {
							names: ['Stephen Curry', 'Damian Lillard']
						},
						metrics: ['pts'],
						filters: {}
					}
				},
				new Date('2026-03-25T12:00:00.000Z')
			),
			executeSemanticQuery({
				query: {
					operation: 'rank',
					entity: 'team',
					subject: {},
					metrics: ['drtg'],
					filters: {
						season: '2023-24'
					}
				}
			})
		]);

		for (const response of responses) {
			assert.equal(response.status, 'ok');
			assert.equal(response.provenance.dataFreshnessMode, 'nightly');
			assert.deepEqual(response.warnings, []);
			assert.equal(response.provenance.sourceCalls.length > 0, true);

			for (const sourceCall of response.provenance.sourceCalls) {
				assert.equal(sourceCall.cacheStatus, 'hit');
				assert.equal(sourceCall.sourceStatus, 'ok');
				assert.equal(sourceCall.isProvisional, false);
			}
		}
	});
});
