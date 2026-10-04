import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNbaMediaRequestHeaders } from './media-request';

test('NBA media context uses the app origin without leaking paths, questions or credentials', () => {
	const headers = buildNbaMediaRequestHeaders({ origin: 'https://research.example/app?invite=private#secret', range: 'bytes=0-1023' });
	assert.equal(headers.get('referer'), 'https://research.example/');
	assert.equal(headers.get('range'), 'bytes=0-1023');
	assert.equal(headers.get('cookie'), null); assert.equal(headers.get('authorization'), null);
	assert.equal(headers.get('origin'), null);
	assert.equal(headers.get('sec-fetch-dest'), 'video');
	assert.ok(headers.get('user-agent')?.includes('Chrome/'));
	assert.equal(headers.get('accept'), '*/*');
	assert.ok(headers.get('accept-language'));
	assert.equal(buildNbaMediaRequestHeaders({ origin: 'http://localhost:4173/research/123' }).get('referer'), 'http://localhost:4173/');
});

test('non-web and credential-bearing app origins are rejected before a media request', () => {
	for (const origin of ['file:///private', 'javascript:alert(1)', 'https://user:secret@research.example/', 'not a URL']) {
		assert.throws(() => buildNbaMediaRequestHeaders({ origin }));
	}
});
