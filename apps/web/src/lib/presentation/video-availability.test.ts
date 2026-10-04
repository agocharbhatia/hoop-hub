import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkVideoAvailability } from './video-availability';

const clip = { url: 'https://videos.nba.com/nba/pbp/media/2025/11/03/0022500164/51/video.mp4', gameId: '0022500164', eventId: '51' };

test('playback checks the selected compound event without fetching media bytes in the client', async () => {
	const result = await checkVideoAvailability(clip, new AbortController().signal, (async (url, options) => {
		assert.equal(url, '/api/video-availability');
		assert.equal(options?.method, 'POST');
		assert.deepEqual(JSON.parse(String(options?.body)), clip);
		return Response.json({ status: 'unavailable', reason: 'nba_unavailable' });
	}) as typeof fetch);
	assert.deepEqual(result, { status: 'unavailable', reason: 'nba_unavailable' });
});

test('failed checks do not label unverified footage as missing', async () => {
	for (const response of [Response.json({ status: 'available' }), new Response(null, { status: 500 })]) {
		assert.deepEqual(await checkVideoAvailability(clip, new AbortController().signal, (async () => response) as typeof fetch), { status: 'unknown', reason: 'check_failed' });
	}
});

test('changing clips cancels the old check rather than applying its result to another event', async () => {
	const cancellation = new AbortController();
	const pending = checkVideoAvailability(clip, cancellation.signal, (async (_url, options) => {
		return new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
	}) as typeof fetch);
	cancellation.abort();
	await assert.rejects(pending, { name: 'AbortError' });
});
