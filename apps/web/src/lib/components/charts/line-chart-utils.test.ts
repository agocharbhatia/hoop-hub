import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatLineTick, lineTickIndexes } from './line-chart-utils';

test('narrow trend charts keep both endpoints without exceeding their label space', () => {
	assert.deepEqual(lineTickIndexes(10, 240), [0, 9]);
	assert.deepEqual(lineTickIndexes(10, 300), [0, 5, 9]);
	const wide = lineTickIndexes(80, 800);
	assert.equal(wide.length, 8);
	assert.equal(wide[0], 0);
	assert.equal(wide.at(-1), 79);
	assert.equal(new Set(wide).size, wide.length);
	assert.deepEqual(lineTickIndexes(0, 240), []);
	assert.deepEqual(lineTickIndexes(1, 240), [0]);
});

test('trend axis dates stay on their source day across local time zones', () => {
	assert.equal(formatLineTick('2026-01-01'), 'Jan 1');
	assert.equal(formatLineTick('2026-01-01T00:00:00Z'), 'Jan 1');
	assert.equal(formatLineTick('Mar 23'), 'Mar 23');
	assert.equal(formatLineTick(3), '3');
});

test('saved English game dates use compact ticks without treating arbitrary categories as dates', () => {
	assert.equal(formatLineTick('Mar 14, 2025'), 'Mar 14');
	assert.equal(formatLineTick('Apr 13, 2025'), 'Apr 13');
	assert.equal(formatLineTick('Feb 29, 2024'), 'Feb 29');
	assert.equal(formatLineTick('Feb 29, 2025'), 'Feb 29, 20…');
	assert.equal(formatLineTick('May flowers'), 'May flowers');
});
