import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildRawEndpointCacheKey, DataStore, stableStringify } from '$lib/server/data/store';
import { auditMaterializedData } from './data-health';

const SLATE_DATE = '2026-04-01';
const PARAMS = { LeagueID: '00', Season: '2025-26' };

describe('auditMaterializedData', () => {
	test('reports a finalized healthy materialization when run, requests, and cache agree', () => {
		const store = seedCompletedStore();
		const report = auditMaterializedData({ store, slateDate: SLATE_DATE, now: new Date('2026-04-01T10:00:00.000Z') });

		assert.equal(report.healthy, true);
		assert.equal(report.freshness, 'finalized');
		assert.deepEqual(report.counts, {
			requests: 1,
			succeededRequests: 1,
			failedRequests: 0,
			cacheRecords: 1,
			provisionalRecords: 0,
			expiredRecords: 0
		});
		assert.deepEqual(report.issues, []);
	});

	test('separates stale and provisional warnings from corrupt or incomplete errors', () => {
		const staleStore = seedCompletedStore({ provisional: true, expiresAt: '2026-04-01T09:00:00.000Z' });
		const staleReport = auditMaterializedData({
			store: staleStore,
			slateDate: SLATE_DATE,
			now: new Date('2026-04-01T10:00:00.000Z')
		});
		assert.equal(staleReport.healthy, false);
		assert.equal(staleReport.freshness, 'provisional');
		assert.deepEqual(staleReport.issues.map((issue) => issue.code).sort(), ['record_expired', 'record_provisional']);

		const missingStore = new DataStore({ dbPath: ':memory:' });
		const missingReport = auditMaterializedData({ store: missingStore, slateDate: SLATE_DATE });
		assert.equal(missingReport.freshness, 'unavailable');
		assert.equal(missingReport.issues[0]?.code, 'run_missing');
	});
});

/* Helper functions */

function seedCompletedStore(options: { provisional?: boolean; expiresAt?: string } = {}): DataStore {
	const store = new DataStore({ dbPath: ':memory:' });
	const paramsJson = stableStringify(PARAMS);
	const runId = 'audit-run';
	store.startNightlyRun({ runId, slateDate: SLATE_DATE, startedAt: '2026-04-01T08:00:00.000Z' });
	store.upsertNightlyRunRequests({
		runId,
		slateDate: SLATE_DATE,
		createdAt: '2026-04-01T08:00:00.000Z',
		requests: [{ requestKey: 'players', endpointId: 'leaguedashplayerstats', paramsJson, phase: 'league_wide' }]
	});
	store.markNightlyRunRequestRunning({ runId, slateDate: SLATE_DATE, requestKey: 'players', startedAt: '2026-04-01T08:01:00.000Z' });
	store.markNightlyRunRequestSucceeded({
		runId,
		slateDate: SLATE_DATE,
		requestKey: 'players',
		completedAt: '2026-04-01T08:02:00.000Z',
		satisfiedFromCache: false
	});
	store.putRawEndpointCache({
		cacheKey: buildRawEndpointCacheKey({
			endpointId: 'leaguedashplayerstats',
			params: PARAMS,
			parserVersion: 'v1',
			snapshotDate: SLATE_DATE
		}),
		endpointId: 'leaguedashplayerstats',
		paramsJson,
		payloadJson: JSON.stringify({ resultSets: [] }),
		fetchedAt: '2026-04-01T08:02:00.000Z',
		expiresAt: options.expiresAt ?? '2026-04-02T08:02:00.000Z',
		snapshotDate: SLATE_DATE,
		parserVersion: 'v1',
		isProvisional: options.provisional ?? false
	});
	store.completeNightlyRun({
		runId,
		completedAt: '2026-04-01T08:03:00.000Z',
		status: 'completed',
		finalizedBy: 'game_complete_aware'
	});
	return store;
}
