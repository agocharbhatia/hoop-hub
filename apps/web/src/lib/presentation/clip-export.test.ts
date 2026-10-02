import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getClipExportExpiry } from './clip-export';

test('reused clip exports display the persisted deadline rather than a fresh retention period', () => {
	const updatedAt = '2026-10-02T12:00:00.000Z';
	const expiresAt = '2026-10-02T12:02:00.000Z';
	assert.equal(getClipExportExpiry({ updatedAt, expiresAt }), Date.parse(expiresAt));
	assert.equal(getClipExportExpiry({ updatedAt }), Date.parse('2026-10-03T12:00:00.000Z'));
	assert.equal(getClipExportExpiry({ updatedAt: 'invalid', expiresAt: 'invalid' }), null);
});
