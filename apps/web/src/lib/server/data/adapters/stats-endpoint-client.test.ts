import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { buildRawEndpointCacheKey, getDataStore, resetDataStoreForTests } from '$lib/server/data/store';
import { fetchStatsEndpointWithCache } from './stats-endpoint-client';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;
const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

describe('stats-endpoint-client', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
	});

	afterEach(() => {
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
	});

	test('returns cache miss with disabled live fetch when no cache row exists', async () => {
		const now = new Date('2026-02-25T08:00:00.000Z');
		const result = await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now,
			params: {
				LeagueID: '00',
				PerMode: 'PerGame',
				Scope: 'S',
				Season: '2023-24',
				SeasonType: 'Regular Season',
				StatCategory: 'AST',
				ActiveFlag: ''
			}
		});

		assert.equal(result.cacheStatus, 'miss');
		assert.equal(result.sourceStatus, 'error');
		assert.equal(result.payload, null);
	});

	test('returns cache hit when unexpired row exists', async () => {
		const now = new Date('2026-02-25T08:00:00.000Z');
		const params = {
			LeagueID: '00',
			PerMode: 'PerGame',
			Scope: 'S',
			Season: '2023-24',
			SeasonType: 'Regular Season',
			StatCategory: 'AST',
			ActiveFlag: ''
		};

		const cacheKey = buildRawEndpointCacheKey({
			endpointId: 'leagueleaders',
			params: JSON.parse(JSON.stringify(params)),
			parserVersion: 'v1',
			snapshotDate: '2026-02-25'
		});

		getDataStore().putRawEndpointCache({
			cacheKey,
			endpointId: 'leagueleaders',
			paramsJson: JSON.stringify(params),
			payloadJson: JSON.stringify({
				resultSet: {
					headers: ['PLAYER', 'AST'],
					rowSet: [['Tyrese Haliburton', 10.9]]
				}
			}),
			fetchedAt: '2026-02-25T07:45:00.000Z',
			expiresAt: '2026-02-25T09:45:00.000Z',
			snapshotDate: '2026-02-25',
			parserVersion: 'v1',
			isProvisional: true
		});

		const result = await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now,
			params
		});

		assert.equal(result.cacheStatus, 'hit');
		assert.equal(result.sourceStatus, 'ok');
		assert.notEqual(result.payload, null);
	});

	test('returns stale cache hit when row is expired and live fetch is disabled', async () => {
		const now = new Date('2026-02-25T08:00:00.000Z');
		const params = {
			LeagueID: '00',
			PerMode: 'PerGame',
			Scope: 'S',
			Season: '2023-24',
			SeasonType: 'Regular Season',
			StatCategory: 'PTS',
			ActiveFlag: ''
		};

		const cacheKey = buildRawEndpointCacheKey({
			endpointId: 'leagueleaders',
			params: JSON.parse(JSON.stringify(params)),
			parserVersion: 'v1',
			snapshotDate: '2026-02-25'
		});

		getDataStore().putRawEndpointCache({
			cacheKey,
			endpointId: 'leagueleaders',
			paramsJson: JSON.stringify(params),
			payloadJson: JSON.stringify({
				resultSet: {
					headers: ['PLAYER', 'PTS'],
					rowSet: [['Luka Doncic', 33.9]]
				}
			}),
			fetchedAt: '2026-02-25T06:00:00.000Z',
			expiresAt: '2026-02-25T07:00:00.000Z',
			snapshotDate: '2026-02-25',
			parserVersion: 'v1',
			isProvisional: true
		});

		const result = await fetchStatsEndpointWithCache({
			endpointId: 'leagueleaders',
			now,
			params
		});

		assert.equal(result.cacheStatus, 'stale_hit');
		assert.equal(result.stale, true);
		assert.notEqual(result.payload, null);
	});

	test('throws for missing required parameters', async () => {
		await assert.rejects(
			() =>
				fetchStatsEndpointWithCache({
					endpointId: 'leagueleaders',
					params: {
						LeagueID: '00'
					}
				}),
			(error: unknown) => {
				assert.match(String(error), /requires parameter/i);
				return true;
			}
		);
	});
});
