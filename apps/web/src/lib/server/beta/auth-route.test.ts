import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loginClientAddress } from './auth-route';

test('direct loopback Docker login shares a bounded throttle bucket without the proxy header', () => {
	const original = process.env.ORIGIN;
	process.env.ORIGIN = 'http://127.0.0.1:3000';
	try {
		assert.equal(loginClientAddress({ getClientAddress: () => { throw new Error('Missing trusted header'); } }), 'loopback-beta');
		assert.equal(loginClientAddress({ getClientAddress: () => '192.0.2.1' }), '192.0.2.1');
	} finally { if (original === undefined) delete process.env.ORIGIN; else process.env.ORIGIN = original; }
});

test('public login fails closed if the configured proxy header is absent', () => {
	const original = process.env.ORIGIN;
	process.env.ORIGIN = 'https://beta.example.com';
	try { assert.throws(() => loginClientAddress({ getClientAddress: () => { throw new Error('Missing trusted header'); } }), /Missing trusted header/); }
	finally { if (original === undefined) delete process.env.ORIGIN; else process.env.ORIGIN = original; }
});
