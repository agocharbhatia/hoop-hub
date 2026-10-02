import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataStore } from '../store';
import { createDataProviderFetcher, type ProviderFetchRequest } from './client';
import { normalizePbpStatsParams } from './catalog';

/* Test helpers */
const request: ProviderFetchRequest = { providerId: 'pbpstats', datasetId: 'on_off', params: { Season: '2025-26', SeasonType: 'Regular Season', TeamId: '1610612761', PlayerId: '1630567' }, now: new Date('2026-10-02T10:00:00Z') };
const sample = { results: [{ Stat: 'Pts per 100 Possessions', On: '117.259', Off: '113.651' }] };
/* End test helpers */

test('provider cache is persistent, namespaced and independent of parameter insertion order', async () => {
	const store = new DataStore({ dbPath: ':memory:' });
	let calls = 0;
	try {
		const fetcher = createDataProviderFetcher({ store, fetch: async (url) => {
			calls += 1;
			assert.equal(new URL(String(url)).origin, 'https://api.pbpstats.com');
			return Response.json(sample);
		} });
		assert.equal((await fetcher(request)).cacheStatus, 'miss');
		const second = createDataProviderFetcher({ store, fetch: async () => { throw new Error('Cache miss'); } });
		const hit = await second({ ...request, params: Object.fromEntries(Object.entries(request.params).reverse()) });
		assert.equal(hit.cacheStatus, 'hit');
		assert.equal(hit.endpointId, 'pbpstats:on_off');
		assert.equal(hit.fetchedAt, '2026-10-02T10:00:00.000Z');
		assert.equal(calls, 1);
	} finally { store.close(); }
});

test('expired provider snapshots remain explicitly stale when retrieval fails', async () => {
	const store = new DataStore({ dbPath: ':memory:' });
	try {
		await createDataProviderFetcher({ store, fetch: async () => Response.json(sample) })(request);
		const result = await createDataProviderFetcher({ store, allowLiveFetch: false })({ ...request, now: new Date('2026-10-03T10:00:00Z') });
		assert.equal(result.stale, true);
		assert.equal(result.cacheStatus, 'stale_hit');
		assert.deepEqual(result.payload, sample);
	} finally { store.close(); }
});

test('public-display entitlement is checked before serving an internal cached snapshot', async () => {
	const store = new DataStore({ dbPath: ':memory:' });
	const previous = process.env.HOOP_HUB_DATA_USE;
	const permission = process.env.HOOP_HUB_PBPSTATS_PUBLIC_DISPLAY_ALLOWED;
	try {
		process.env.HOOP_HUB_DATA_USE = 'internal';
		const fetcher = createDataProviderFetcher({ store, fetch: async () => Response.json(sample) });
		await fetcher(request);
		process.env.HOOP_HUB_DATA_USE = 'public';
		delete process.env.HOOP_HUB_PBPSTATS_PUBLIC_DISPLAY_ALLOWED;
		const result = await fetcher(request);
		assert.equal(result.payload, null);
		assert.match(result.errorDetail!, /public display/);
	} finally {
		if (previous === undefined) delete process.env.HOOP_HUB_DATA_USE; else process.env.HOOP_HUB_DATA_USE = previous;
		if (permission === undefined) delete process.env.HOOP_HUB_PBPSTATS_PUBLIC_DISPLAY_ALLOWED; else process.env.HOOP_HUB_PBPSTATS_PUBLIC_DISPLAY_ALLOWED = permission;
		store.close();
	}
});

test('provider errors, rate limits and malformed payloads cannot become valid empty datasets', async () => {
	for (const response of [new Response('upstream', { status: 429 }), Response.json({ error: 'unavailable' }), new Response('not JSON'), new Response('oversized', { headers: { 'content-length': '9000000' } })]) {
		const store = new DataStore({ dbPath: ':memory:' });
		try {
			const result = await createDataProviderFetcher({ store, fetch: async () => response })(request);
			assert.equal(result.payload, null);
			assert.equal(result.sourceStatus, response.status === 429 ? 'rate_limited' : 'error');
		} finally { store.close(); }
	}
});

test('provider scopes reject unsupported filters, altered constants, invalid seasons and duplicate players', () => {
	assert.throws(() => normalizePbpStatsParams('lineups', { ...request.params, Type: 'Opponent' }));
	assert.throws(() => normalizePbpStatsParams('on_off', { ...request.params, Season: '2025-27' }));
	assert.throws(() => normalizePbpStatsParams('on_off', { ...request.params, Opponent: '1610612738' }));
	assert.throws(() => normalizePbpStatsParams('combinations', { Season: '2025-26', SeasonType: 'Playoffs', TeamId: '1610612761', PlayerIds: '1,1' }));
});

test('cancellation propagates to provider transport and is never returned as stale success', async () => {
	const store = new DataStore({ dbPath: ':memory:' });
	const controller = new AbortController();
	try {
		const fetcher = createDataProviderFetcher({ store, fetch: async (_, init) => new Promise((_, reject) => {
			init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
			controller.abort(new Error('User cancelled'));
		}) });
		await assert.rejects(fetcher({ ...request, signal: controller.signal }), /User cancelled/);
	} finally { store.close(); }
});
