import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from './hooks.server';

/* Request fixture helpers */

async function resolvePage(path: string, contentType: string) {
	const event = {
		url: new URL(path, 'http://localhost'),
		request: new Request(new URL(path, 'http://localhost')),
		cookies: { get: () => undefined },
		locals: {},
		route: { id: path }
	} as unknown as Parameters<typeof handle>[0]['event'];
	return handle({ event, resolve: async () => new Response('', { headers: { 'content-type': contentType } }) });
}

/* End request fixture helpers */

test('research documents allow origin-only media referrers while login and API responses remain private', async () => {
	const previous = process.env.HOOP_HUB_AUTH_MODE;
	process.env.HOOP_HUB_AUTH_MODE = 'local';
	try {
		const research = await resolvePage('/?session=private-research-id', 'text/html; charset=utf-8');
		assert.equal(research.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
		assert.equal(research.headers.get('x-frame-options'), 'DENY');
		assert.equal(research.headers.get('x-content-type-options'), 'nosniff');
		assert.equal(research.headers.get('cache-control'), 'private, no-store');
		for (const [path, contentType] of [['/login', 'text/html'], ['/api/research', 'application/json'], ['/_app/asset.js', 'application/javascript']]) {
			assert.equal((await resolvePage(path, contentType)).headers.get('referrer-policy'), 'no-referrer');
		}
	} finally {
		if (previous === undefined) delete process.env.HOOP_HUB_AUTH_MODE;
		else process.env.HOOP_HUB_AUTH_MODE = previous;
	}
});
