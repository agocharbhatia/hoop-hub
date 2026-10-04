import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBarGeometry } from './bar-chart-utils';

test('horizontal bars preserve ratios from zero for positive-only and negative-only samples', () => {
	const positive = createBarGeometry([10, 20]);
	assert.equal(positive.zero, 0);
	assert.deepEqual(positive.position(10), { left: 0, width: 50 });
	assert.deepEqual(positive.position(20), { left: 0, width: 100 });

	const negative = createBarGeometry([-10, -20]);
	assert.equal(negative.zero, 100);
	assert.deepEqual(negative.position(-10), { left: 50, width: 50 });
	assert.deepEqual(negative.position(-20), { left: 0, width: 100 });
});

test('mixed signs share one baseline without turning negative values into positive bars', () => {
	const geometry = createBarGeometry([-5, 15, 0]);
	assert.equal(geometry.zero, 25);
	assert.deepEqual(geometry.position(-5), { left: 0, width: 25 });
	assert.deepEqual(geometry.position(15), { left: 25, width: 75 });
	assert.deepEqual(geometry.position(0), { left: 25, width: 0 });
});

test('zero and empty samples remain finite and an invalid value cannot distort the scale', () => {
	for (const values of [[], [0, 0], [NaN, Infinity, -Infinity]]) {
		const geometry = createBarGeometry(values);
		assert.equal(geometry.zero, 0);
		assert.deepEqual(geometry.position(0), { left: 0, width: 0 });
		assert.deepEqual(geometry.position(NaN), { left: 0, width: 0 });
	}
	assert.deepEqual(createBarGeometry([NaN, 20]).position(10), { left: 0, width: 50 });
});

test('finite extremes and subnormal values remain measurable without arithmetic overflow', () => {
	const large = createBarGeometry([-Number.MAX_VALUE, Number.MAX_VALUE]);
	assert.equal(large.zero, 50);
	assert.deepEqual(large.position(-Number.MAX_VALUE), { left: 0, width: 50 });
	assert.deepEqual(large.position(Number.MAX_VALUE), { left: 50, width: 50 });
	assert.deepEqual(createBarGeometry([Number.MIN_VALUE]).position(Number.MIN_VALUE), { left: 0, width: 100 });
});
