import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseDataHealthArgs } from './data-health-cli';

describe('parseDataHealthArgs', () => {
	test('parses the required slate and optional deterministic audit clock', () => {
		const options = parseDataHealthArgs([
			'--slate-date',
			'2026-04-01',
			'--as-of',
			'2026-04-02T12:00:00.000Z'
		]);
		assert.equal(options.slateDate, '2026-04-01');
		assert.equal(options.asOf?.toISOString(), '2026-04-02T12:00:00.000Z');
	});

	test('rejects malformed dates', () => {
		assert.throws(() => parseDataHealthArgs(['--slate-date', 'April 1']), /Usage/);
		assert.throws(
			() => parseDataHealthArgs(['--slate-date', '2026-04-01', '--as-of', 'tomorrow']),
			/valid ISO timestamp/
		);
	});
});
