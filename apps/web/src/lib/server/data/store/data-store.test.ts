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
});
