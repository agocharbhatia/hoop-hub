import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyNbaMediaResponse, createVideoAvailabilityService, isVideoAvailabilityRequest } from './availability';
import { isCanonicalNbaVideo, verifiedNbaMediaRedirect } from './provenance';
import { POST, _setVideoAvailabilityServiceForTests } from '../../../routes/api/video-availability/+server';
import { LOCAL_PRINCIPAL } from '$lib/server/beta/context';

/* Video fixture helpers */

const clip = { gameId: '0022500164', eventId: '51', url: 'https://videos.nba.com/nba/pbp/media/2025/11/03/0022500164/51/091c5e7e-2501-020f-a545-85ef2a1cd887_960x540.mp4' };
const slateHeaders = { 'content-type': 'video/mp4', 'content-length': '31580089', etag: '"2dd8e05a98fc6949fa7ec979b0905464:1754501139.183376"' };
function event(body: string, signedIn = true) {
	return { request: new Request('http://localhost/api/video-availability', { method: 'POST', body }), locals: { user: signedIn ? LOCAL_PRINCIPAL : null } } as Parameters<typeof POST>[0];
}
function nextClip(eventId: string) { return { ...clip, eventId, url: clip.url.replace('/51/', `/${eventId}/`) }; }

/* End video fixture helpers */

test('NBA HTTP 200 unavailable slate is rejected using its verified media fingerprint', () => {
	const placeholder = new Response(null, { headers: {
		'content-type': 'video/mp4', 'content-length': '31580089',
		etag: '"2dd8e05a98fc6949fa7ec979b0905464:1754501139.183376"'
	} });
	assert.deepEqual(classifyNbaMediaResponse(placeholder), { status: 'unavailable', reason: 'nba_unavailable' });
});

test('partial GET responses use the complete media size to identify the slate', () => {
	assert.deepEqual(classifyNbaMediaResponse(new Response(null, { status: 206, headers: {
		...slateHeaders, 'content-length': '1024', 'content-range': 'bytes 0-1023/31580089'
	} })), { status: 'unavailable', reason: 'nba_unavailable' });
	for (const range of ['bytes 0-1023/*', 'bytes 0-1023/5613822', 'bytes 1023-0/31580089', 'bytes 0-31580089/31580089']) {
		assert.deepEqual(classifyNbaMediaResponse(new Response(null, { status: 206, headers: {
			...slateHeaders, 'content-length': '1024', 'content-range': range
		} })), { status: 'unknown', reason: 'unrecognized' });
	}
});

test('file size and HTTP success cannot independently prove a placeholder or playable footage', () => {
	for (const headers of [
		{ ...slateHeaders, etag: '"other-content"' },
		{ ...slateHeaders, 'content-length': '31580088' },
		{ ...slateHeaders, 'content-type': 'text/html' },
		{ 'content-type': 'video/mp4' }
	]) assert.deepEqual(classifyNbaMediaResponse(new Response(null, { headers })), { status: 'unknown', reason: 'unrecognized' });
	assert.deepEqual(classifyNbaMediaResponse(new Response(null, { status: 429, headers: { 'retry-after': '12' } })), { status: 'unknown', reason: 'rate_limited', retryAfterSeconds: 12 });
	assert.deepEqual(classifyNbaMediaResponse(new Response(null, { status: 404 })), { status: 'unavailable', reason: 'source_unavailable' });
	assert.deepEqual(classifyNbaMediaResponse(new Response(null, { status: 503 })), { status: 'unknown', reason: 'check_failed' });
});

test('media provenance excludes arbitrary hosts, credentials, mismatched events, malformed dates and query strings', () => {
	assert.equal(isCanonicalNbaVideo(clip), true);
	assert.equal(isVideoAvailabilityRequest(clip), true);
	for (const invalid of [
		{ ...clip, url: clip.url.replace('https:', 'http:') },
		{ ...clip, url: clip.url.replace('videos.nba.com', '127.0.0.1') },
		{ ...clip, url: clip.url.replace('videos.nba.com', 'videos.nba.com.example.com') },
		{ ...clip, url: clip.url.replace('videos.nba.com', 'videos.nba.com:8443') },
		{ ...clip, url: clip.url.replace('videos.nba.com', 'user@videos.nba.com') },
		{ ...clip, url: clip.url.replace('/11/03/', '/02/31/') },
		{ ...clip, url: `${clip.url}?url=http://127.0.0.1/` },
		{ ...clip, url: `${clip.url}#ignored` },
		{ ...clip, eventId: '52' }, { ...clip, gameId: '0022500165' },
		{ ...clip, extra: true }, { ...clip, eventId: 51 }
	]) assert.equal(isVideoAvailabilityRequest(invalid), false);
});

test('selected-clip checks use bounded GET requests, cancel bodies, deduplicate and cache', async () => {
	let now = 1_000; let calls = 0; let cancelled = 0;
	const service = createVideoAvailabilityService({ nowMs: () => now, mediaOrigin: 'http://localhost/', fetchImpl: (async (_url, init) => {
		calls++; assert.equal(String(_url), `${clip.url}?hoop_hub_media=referrer-v1`); assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'manual');
		const headers = new Headers(init?.headers);
		assert.equal(headers.get('range'), 'bytes=0-1023');
		assert.equal(headers.get('referer'), 'http://localhost/');
		assert.equal(headers.get('accept'), '*/*');
		assert.ok(headers.get('accept-language'));
		assert.equal(headers.get('sec-fetch-dest'), 'video');
		return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 206, headers: {
			...slateHeaders, 'content-length': '1024', 'content-range': 'bytes 0-1023/31580089'
		} });
	}) as typeof fetch });
	const results = await Promise.all(Array.from({ length: 10 }, () => service.check(clip)));
	assert.equal(calls, 1); assert.equal(cancelled, 1);
	assert.ok(results.every((result) => result.reason === 'nba_unavailable'));
	await service.check(clip); assert.equal(calls, 1);
	now += 300_001; await service.check(clip); assert.equal(calls, 2);
});

test('a misleading HEAD slate cannot reject the real GET asset', async () => {
	const methods: string[] = [];
	const service = createVideoAvailabilityService({ fetchImpl: (async (_url, init) => {
		methods.push(init?.method ?? 'GET');
		return init?.method === 'HEAD' ? new Response(null, { headers: slateHeaders }) : new Response(null, { status: 206, headers: {
			'content-type': 'video/mp4', 'content-length': '1024', 'content-range': 'bytes 0-1023/5613822', etag: '"786b30614df00e093f29f8bf32b4c8a4"'
		} });
	}) as typeof fetch });
	assert.deepEqual(await service.check(clip), { status: 'unknown', reason: 'unrecognized' });
	assert.deepEqual(methods, ['GET']);
});

test('redirects remain on the same official event and never fetch an external target', async () => {
	for (const location of ['http://127.0.0.1/private', clip.url.replace('/51/', '/52/'), 'https://example.com/video.mp4']) {
		let calls = 0;
		const service = createVideoAvailabilityService({ fetchImpl: (async () => { calls++; return new Response(null, { status: 302, headers: { location } }); }) as typeof fetch });
		assert.equal((await service.check(clip)).reason, 'check_failed'); assert.equal(calls, 1);
	}
	let calls = 0;
	const service = createVideoAvailabilityService({ fetchImpl: (async () => ++calls === 1 ? new Response(null, { status: 302, headers: { location: clip.url.replace('_960x540', '_1280x720') } }) : new Response(null, { headers: slateHeaders })) as typeof fetch });
	assert.equal((await service.check(clip)).reason, 'nba_unavailable'); assert.equal(calls, 2);
});

test('bounded cache and concurrent work prevent a playlist from opening an unbounded fetch queue', async () => {
	let calls = 0; let finish!: (response: Response) => void;
	const service = createVideoAvailabilityService({ maxActive: 1, maxCache: 2, fetchImpl: (async () => {
		calls++; return new Promise<Response>((resolve) => { finish = resolve; });
	}) as typeof fetch });
	const pending = service.check(clip);
	assert.equal((await service.check(nextClip('52'))).reason, 'check_failed'); assert.equal(calls, 1);
	finish(new Response(null)); await pending;
	for (const eventId of ['52', '53', '51']) {
		const check = service.check(nextClip(eventId)); finish(new Response(null)); await check;
	}
	assert.equal(calls, 4);
});

test('cancelling one caller preserves shared checks and the last cancellation aborts upstream work', async () => {
	let upstream!: AbortSignal; let finish!: (response: Response) => void;
	const service = createVideoAvailabilityService({ fetchImpl: (async (_url, init) => {
		upstream = init!.signal!;
		return new Promise<Response>((resolve, reject) => {
			finish = resolve; upstream.addEventListener('abort', () => reject(upstream.reason), { once: true });
		});
	}) as typeof fetch });
	const first = new AbortController(); const second = new AbortController();
	const pendingFirst = service.check(clip, first.signal); const pendingSecond = service.check(clip, second.signal);
	first.abort(); await assert.rejects(pendingFirst); assert.equal(upstream.aborted, false);
	finish(new Response(null, { headers: slateHeaders })); assert.equal((await pendingSecond).reason, 'nba_unavailable');
	const third = new AbortController(); const pendingThird = service.check(nextClip('52'), third.signal);
	third.abort(); await assert.rejects(pendingThird); assert.equal(upstream.aborted, true);
});

test('probe deadlines and transient errors leave media unverified instead of inventing absence', async () => {
	const keepAlive = setTimeout(() => {}, 100);
	try {
		const service = createVideoAvailabilityService({ timeoutMs: 5, fetchImpl: (async (_url, init) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }))) as typeof fetch });
		assert.deepEqual(await service.check(clip), { status: 'unknown', reason: 'check_failed' });
	} finally { clearTimeout(keepAlive); }
});

test('availability route requires authentication and a small canonical request before checking upstream', async () => {
	let calls = 0;
	_setVideoAvailabilityServiceForTests({ async check() { calls++; return { status: 'unavailable', reason: 'nba_unavailable' }; } });
	try {
		assert.equal((await POST(event(JSON.stringify(clip), false))).status, 401);
		assert.equal((await POST(event('invalid-json'))).status, 400);
		assert.equal((await POST(event(JSON.stringify({ ...clip, url: 'https://example.com/file.mp4' })))).status, 400);
		assert.equal((await POST(event(JSON.stringify({ ...clip, padding: 'x'.repeat(2_048) })))).status, 413);
		assert.equal(calls, 0);
		const response = await POST(event(JSON.stringify(clip)));
		assert.equal(response.status, 200); assert.equal(calls, 1);
		assert.deepEqual(await response.json(), { status: 'unavailable', reason: 'nba_unavailable' });
	} finally { _setVideoAvailabilityServiceForTests(null); }
});

test('verified redirects preserve the repair key without accepting other parameters or events', () => {
	const repaired = `${clip.url}?hoop_hub_media=referrer-v1`;
	assert.equal(verifiedNbaMediaRedirect(repaired, repaired, clip), repaired);
	assert.equal(verifiedNbaMediaRedirect('?hoop_hub_media=referrer-v1', repaired, clip), repaired);
	for (const location of [repaired + '&extra=1', repaired + '&hoop_hub_media=referrer-v1', repaired.replace('/51/', '/52/'), repaired.replace('videos.nba.com', 'example.com'), `${clip.url}?hoop_hub_media=other`]) {
		assert.equal(verifiedNbaMediaRedirect(location, repaired, clip), null);
	}
});
