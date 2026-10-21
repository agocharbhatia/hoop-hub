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
		const fetcher = createDataProviderFetcher({ store, allowLiveFetch: true, fetch: async (url) => {
			calls += 1;
			assert.equal(new URL(String(url)).origin, 'https://api.pbpstats.com');
			return Response.json(sample);
		} });
		assert.equal((await fetcher(request)).cacheStatus, 'miss');
		const second = createDataProviderFetcher({ store, allowLiveFetch: true, fetch: async () => { throw new Error('Cache miss'); } });
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
		await createDataProviderFetcher({ store, allowLiveFetch: true, fetch: async () => Response.json(sample) })(request);
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
		const fetcher = createDataProviderFetcher({ store, allowLiveFetch: true, fetch: async () => Response.json(sample) });
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
			const result = await createDataProviderFetcher({ store, allowLiveFetch: true, fetch: async () => response.clone() })(request);
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
		const fetcher = createDataProviderFetcher({ store, allowLiveFetch: true, fetch: async (_, init) => new Promise((_, reject) => {
			init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
			controller.abort(new Error('User cancelled'));
		}) });
		await assert.rejects(fetcher({ ...request, signal: controller.signal }), /User cancelled/);
	} finally { store.close(); }
});

test('transient failures retry once with identical scope and cache recovered data', async () => {
	for (const first of [429, 500, 502, 503, 504, 'timeout', 'network']) {
		const store = new DataStore({ dbPath: ':memory:' });
		const urls: string[] = [];
		try {
			const fetcher = createDataProviderFetcher({ store, allowLiveFetch: true, retryDelayMs: 0, fetch: async url => {
				urls.push(String(url));
				if (urls.length === 1) {
					if (first === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
					if (first === 'network') throw new TypeError('Connection reset');
					return new Response('temporary failure', { status: first as number });
				}
				return Response.json(sample);
			} });
			const result = await fetcher(request);
			assert.equal(result.sourceStatus, 'ok');
			assert.deepEqual(result.payload, sample);
			assert.equal(urls.length, 2);
			assert.equal(urls[0], urls[1]);
			assert.equal((await fetcher(request)).cacheStatus, 'hit');
			assert.equal(urls.length, 2);
		} finally { store.close(); }
	}
});

test('permanent errors and invalid data do not retry; transient attempts are bounded', async () => {
	for (const status of [400, 401, 403, 404, 503, 429, 200]) {
		const store = new DataStore({ dbPath: ':memory:' });
		let calls = 0;
		try {
			const result = await createDataProviderFetcher({ store, allowLiveFetch: true, retryDelayMs: 0, fetch: async () => {
				calls++; return new Response('invalid JSON', { status });
			} })(request);
			assert.equal(calls, [503, 429].includes(status) ? 2 : 1);
			assert.equal(result.retryable, [503, 429].includes(status));
			assert.equal(result.payload, null);
		} finally { store.close(); }
	}
});

test('Retry-After waits respect the total deadline and cancellation stops backoff', async () => {
	for (const cancelled of [true, false]) {
		const store = new DataStore({ dbPath: ':memory:' });
		const controller = new AbortController();
		let calls = 0;
		try {
			const work = createDataProviderFetcher({ store, allowLiveFetch: true, totalTimeoutMs: 40, fetch: async () => {
				calls++;
				if (cancelled) setTimeout(() => controller.abort(new Error('User cancelled')), 5);
				return new Response('busy', { status: 429, headers: { 'retry-after': '120' } });
			} })({ ...request, signal: controller.signal });
			if (cancelled) await assert.rejects(work, /User cancelled/);
			else assert.equal((await work).sourceStatus, 'timeout');
			assert.equal(calls, 1);
		} finally { store.close(); }
	}
});

test('exhausted HTTP failures preserve explicitly stale snapshots', async () => {
	const store = new DataStore({ dbPath: ':memory:' });
	try {
		await createDataProviderFetcher({ store, allowLiveFetch: true, fetch: async () => Response.json(sample) })(request);
		const result = await createDataProviderFetcher({ store, allowLiveFetch: true, retryDelayMs: 0, fetch: async () => new Response('down', { status: 503 }) })({ ...request, now: new Date('2026-10-03T10:00:00Z') });
		assert.equal(result.cacheStatus, 'stale_hit');
		assert.equal(result.stale, true);
		assert.deepEqual(result.payload, sample);
	} finally { store.close(); }
});

test('an aborted first-attempt deadline can recover on the second attempt', async () => {
	const store = new DataStore({ dbPath: ':memory:' });
	let calls = 0;
	try {
		const result = await createDataProviderFetcher({ store, allowLiveFetch: true, timeoutMs: 10, retryDelayMs: 0, fetch: async (_, init) => {
			if (++calls === 2) return Response.json(sample);
			return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
		} })(request);
		assert.equal(result.sourceStatus, 'ok');
		assert.equal(calls, 2);
	} finally { store.close(); }
});
