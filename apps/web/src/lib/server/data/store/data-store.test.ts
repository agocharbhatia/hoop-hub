import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildRawEndpointCacheKey } from './cache-key';
import { DataStore } from './data-store';

describe('data-store', () => {
	test('stores and retrieves raw endpoint cache records', () => {
		const store = new DataStore({ dbPath: ':memory:' });
		try {
			const cacheKey = buildRawEndpointCacheKey({
				endpointId: 'leagueleaders',
				params: { season: '2024-25', seasonType: 'Regular Season' },
				parserVersion: 'v1',
				snapshotDate: '2026-02-25'
			});

			store.putRawEndpointCache({
				cacheKey,
				endpointId: 'leagueleaders',
				paramsJson: JSON.stringify({ season: '2024-25', seasonType: 'Regular Season' }),
				payloadJson: JSON.stringify({ rowSet: [] }),
				fetchedAt: '2026-02-25T05:00:00.000Z',
				expiresAt: '2026-02-26T05:00:00.000Z',
				snapshotDate: '2026-02-25',
				parserVersion: 'v1',
				isProvisional: false
			});

			const cached = store.getRawEndpointCache(cacheKey);
			assert.notEqual(cached, null);
			assert.equal(cached?.endpointId, 'leagueleaders');
			assert.equal(cached?.isProvisional, false);
			assert.equal((cached?.checksum.length ?? 0) > 0, true);
		} finally {
			store.close();
		}
	});

	test('selects the latest raw endpoint cache record at or before the requested snapshot date', () => {
		const store = new DataStore({ dbPath: ':memory:' });
		try {
			const params = { season: '2024-25', seasonType: 'Regular Season' };

			for (const snapshotDate of ['2026-02-24', '2026-02-25']) {
				store.putRawEndpointCache({
					cacheKey: buildRawEndpointCacheKey({
						endpointId: 'leagueleaders',
						params,
						parserVersion: 'v1',
						snapshotDate
					}),
					endpointId: 'leagueleaders',
					paramsJson: JSON.stringify(params),
					payloadJson: JSON.stringify({ snapshotDate }),
					fetchedAt: `${snapshotDate}T05:00:00.000Z`,
					expiresAt: `${snapshotDate}T23:59:59.000Z`,
					snapshotDate,
					parserVersion: 'v1',
					isProvisional: false
				});
			}

			const cached = store.getLatestRawEndpointCache({
				endpointId: 'leagueleaders',
				paramsJson: JSON.stringify(params),
				parserVersion: 'v1',
				snapshotDate: '2026-02-26'
			});

			assert.notEqual(cached, null);
			assert.equal(cached?.snapshotDate, '2026-02-25');
			assert.equal(cached?.payloadJson, JSON.stringify({ snapshotDate: '2026-02-25' }));
		} finally {
			store.close();
		}
	});

	test('does not select raw endpoint cache rows after the requested snapshot date', () => {
		const store = new DataStore({ dbPath: ':memory:' });
		try {
			const params = { season: '2024-25', seasonType: 'Regular Season' };

			store.putRawEndpointCache({
				cacheKey: buildRawEndpointCacheKey({
					endpointId: 'leagueleaders',
					params,
					parserVersion: 'v1',
					snapshotDate: '2026-02-27'
				}),
				endpointId: 'leagueleaders',
				paramsJson: JSON.stringify(params),
				payloadJson: JSON.stringify({ snapshotDate: '2026-02-27' }),
				fetchedAt: '2026-02-27T05:00:00.000Z',
				expiresAt: '2026-02-27T23:59:59.000Z',
				snapshotDate: '2026-02-27',
				parserVersion: 'v1',
				isProvisional: false
			});

			const cached = store.getLatestRawEndpointCache({
				endpointId: 'leagueleaders',
				paramsJson: JSON.stringify(params),
				parserVersion: 'v1',
				snapshotDate: '2026-02-26'
			});

			assert.equal(cached, null);
		} finally {
			store.close();
		}
	});

	test('starts and completes nightly runs', () => {
		const store = new DataStore({ dbPath: ':memory:' });
		try {
			const run = store.startNightlyRun({
				runId: 'run-1',
				slateDate: '2026-02-24',
				startedAt: '2026-02-25T08:15:00.000Z'
			});

			assert.equal(run.status, 'running');
			assert.equal(run.finalizedBy, null);

			const completed = store.completeNightlyRun({
				runId: 'run-1',
				completedAt: '2026-02-25T08:25:00.000Z',
				status: 'completed',
				finalizedBy: 'game_complete_aware'
			});

			assert.notEqual(completed, null);
			assert.equal(completed?.status, 'completed');
			assert.equal(completed?.finalizedBy, 'game_complete_aware');
			assert.equal(store.getLatestNightlyRunForSlate('2026-02-24')?.runId, 'run-1');
		} finally {
			store.close();
		}
	});

	test('replaces and reads trace source calls', () => {
		const store = new DataStore({ dbPath: ':memory:' });
		try {
			store.replaceTraceSourceCalls('trace-1', 'nightly', [
				{
					endpointId: 'leagueleaders',
					cacheStatus: 'hit',
					latencyMs: 100,
					stale: false,
					isProvisional: false,
					parserVersion: 'v1',
					sourceStatus: 'ok'
				},
				{
					endpointId: 'playerprofilev2',
					cacheStatus: 'hit',
					latencyMs: 90,
					stale: false,
					isProvisional: false,
					parserVersion: 'v1',
					sourceStatus: 'ok'
				}
			]);

			store.replaceTraceSourceCalls('trace-1', 'provisional_live', [
				{
					endpointId: 'leagueleaders',
					cacheStatus: 'miss',
					latencyMs: 140,
					stale: false,
					isProvisional: true,
					parserVersion: 'v1',
					sourceStatus: 'ok'
				}
			]);

			const traceSources = store.getTraceSourceCalls('trace-1');
			assert.equal(traceSources.dataFreshnessMode, 'provisional_live');
			assert.equal(traceSources.sourceCalls.length, 1);
			assert.equal(traceSources.sourceCalls[0].endpointId, 'leagueleaders');
			assert.equal(traceSources.sourceCalls[0].isProvisional, true);
		} finally {
			store.close();
		}
	});

	test('replaces and looks up player directory entries', () => {
		const store = new DataStore({ dbPath: ':memory:' });
		try {
			store.replacePlayerDirectorySnapshot('snapshot-v1', '2026-03-25T12:00:00.000Z', [
				{
					playerId: '201939',
					canonicalName: 'Stephen Curry',
					normalizedName: 'stephen curry',
					teamId: '1610612744'
				},
				{
					playerId: '203999',
					canonicalName: 'Nikola Jokic',
					normalizedName: 'nikola jokic',
					teamId: '1610612743'
				}
			]);

			assert.equal(store.countPlayerDirectoryEntries(), 2);
			assert.deepEqual(store.getPlayerDirectoryEntryById('201939'), {
				playerId: '201939',
				canonicalName: 'Stephen Curry',
				normalizedName: 'stephen curry',
				teamId: '1610612744',
				snapshotVersion: 'snapshot-v1',
				importedAt: '2026-03-25T12:00:00.000Z'
			});
			assert.deepEqual(store.getPlayerDirectoryEntriesByNormalizedName('nikola jokic'), [
				{
					playerId: '203999',
					canonicalName: 'Nikola Jokic',
					normalizedName: 'nikola jokic',
					teamId: '1610612743',
					snapshotVersion: 'snapshot-v1',
					importedAt: '2026-03-25T12:00:00.000Z'
				}
			]);
		} finally {
			store.close();
		}
	});
});
