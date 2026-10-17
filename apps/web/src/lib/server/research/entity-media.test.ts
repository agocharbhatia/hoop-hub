import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEntityMediaLoader } from './entity-media';

test('media loading accepts only canonical identities and shares cached/in-flight bytes', async () => {
	const requested: string[] = [];
	const loader = createEntityMediaLoader(async input => { requested.push(String(input)); return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }); });
	assert.equal(await loader('other', '201939'), null); assert.equal(await loader('player', 'https://example.invalid'), null);
	assert.equal(requested.length, 0);
	const [first, second] = await Promise.all([loader('player', '201939'), loader('player', '201939')]);
	assert.equal(first, second); assert.equal(await loader('player', '201939'), first);
	assert.deepEqual(requested, ['https://cdn.nba.com/headshots/nba/latest/260x190/201939.png']);
});

test('media loading rejects wrong types and oversized bodies, and bounds concurrent upstream work', async () => {
	assert.equal(await createEntityMediaLoader(async () => new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }))('player', '201939'), null);
	assert.equal(await createEntityMediaLoader(async () => new Response(new Uint8Array(1_048_577), { headers: { 'content-type': 'image/png' } }))('player', '201939'), null);
	let release!: () => void, count = 0;
	const barrier = new Promise<void>(resolve => release = resolve);
	const loader = createEntityMediaLoader(async () => { count++; await barrier; return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }); });
	const pending = ['201939', '1628369', '203999', '1630567'].map(id => loader('player', id));
	assert.equal(await loader('player', '1629029'), null); assert.equal(count, 4);
	release(); await Promise.all(pending);
});
