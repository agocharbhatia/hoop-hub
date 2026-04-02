import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseNightlyBootstrapArgs } from './bootstrap-cli';

describe('parseNightlyBootstrapArgs', () => {
	test('accepts a required slate date positional argument', () => {
		assert.deepEqual(parseNightlyBootstrapArgs(['2026-04-01']), {
			slateDate: '2026-04-01'
		});
	});

	test('accepts a required slate date flag', () => {
		assert.deepEqual(parseNightlyBootstrapArgs(['--slate-date', '2026-04-01']), {
			slateDate: '2026-04-01'
		});
	});

	test('rejects missing slate date', () => {
		assert.throws(() => parseNightlyBootstrapArgs([]), /requires a slate date/i);
	});
});
