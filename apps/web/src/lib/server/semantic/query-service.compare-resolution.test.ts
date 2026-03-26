import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { resetDataStoreForTests } from '$lib/server/data/store';
import { installSemanticFixtureFetch } from '../../../tests/helpers/semantic-fixture-fetch';
import { executeSemanticQuery } from './query-service';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

describe('executeSemanticQuery comparison canonicalization', () => {
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

	test('canonicalizes id-only comparison requests in provenance', async () => {
		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'compare',
					entity: 'player',
					subject: {
						ids: ['201939', '203081']
					},
					metrics: ['pts'],
					filters: {}
				}
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['201939', '203081'],
			names: ['Stephen Curry', 'Damian Lillard']
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
	});

	test('canonicalizes exact-name comparison requests in provenance', async () => {
		const response = await executeSemanticQuery(
			{
				query: {
					operation: 'compare',
					entity: 'player',
					subject: {
						names: ['stephen curry', 'damian lillard']
					},
					metrics: ['pts'],
					filters: {}
				}
			},
			new Date('2026-03-25T12:00:00.000Z')
		);

		assert.equal(response.status, 'ok');
		assert.deepEqual(response.provenance.resolvedQuery?.subject, {
			ids: ['201939', '203081'],
			names: ['Stephen Curry', 'Damian Lillard']
		});
		assert.equal(response.provenance.resolvedQuery?.filters.season, '2025-26');
		assert.equal(response.provenance.resolvedQuery?.filters.seasonType, 'Regular Season');
	});
});
