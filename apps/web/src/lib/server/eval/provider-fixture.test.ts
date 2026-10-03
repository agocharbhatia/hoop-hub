import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POSSESSION_EVAL_CASES } from './possession-cases';
import { createScopedProviderFixtureFetcher } from './provider-fixture';
import { runEvalSuite } from './runner';

test('provider fixtures reject altered populations and unknown datasets without a live fallback', async () => {
	const fetcher = createScopedProviderFixtureFetcher(POSSESSION_EVAL_CASES[0]);
	const request = { providerId: 'pbpstats' as const, datasetId: 'on_off', params: { Season: '2025-26', SeasonType: 'Regular Season', TeamId: '1610612761', PlayerId: '1630567' } };
	assert.equal((await fetcher(request)).sourceStatus, 'ok');
	for (const changed of [{ Season: '2024-25' }, { SeasonType: 'Playoffs' }, { TeamId: '1610612738' }, { PlayerId: '1630193' }]) await assert.rejects(fetcher({ ...request, params: { ...request.params, ...changed } }), /Unrecorded/);
	await assert.rejects(fetcher({ ...request, datasetId: 'lineups', params: { Season: '2025-26', SeasonType: 'Regular Season', TeamId: '1610612761' } }), /Unrecorded/);
});

test('provider question variants verify full-population ranking and source-owned artifacts in local evaluation', async () => {
	const suite = await runEvalSuite({ mode: 'local', cases: POSSESSION_EVAL_CASES });
	assert.equal(suite.passed, true, JSON.stringify(suite.records.map((record) => record.failures)));
	assert.equal(suite.records.length, 4);
	assert.ok(suite.records.every((record) => record.endpointCalls.length > 0 && record.endpointCalls.every((call) => call.endpointId.startsWith('pbpstats:'))));
});
