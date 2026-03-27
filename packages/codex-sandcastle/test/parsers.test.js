import assert from 'node:assert/strict';
import test from 'node:test';
import { extractTaggedJson, hasPromiseToken } from '../src/parsers.js';

test('extractTaggedJson parses the first matching tagged JSON payload', () => {
	const parsed = extractTaggedJson('intro <plan>{"issues":[{"number":2}]}</plan> outro', 'plan');

	assert.deepEqual(parsed, { issues: [{ number: 2 }] });
});

test('hasPromiseToken detects completion marker', () => {
	assert.equal(hasPromiseToken('something <promise>COMPLETE</promise> else', 'COMPLETE'), true);
	assert.equal(hasPromiseToken('something else', 'COMPLETE'), false);
});
