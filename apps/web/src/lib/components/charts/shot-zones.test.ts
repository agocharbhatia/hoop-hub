import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferredShotView, shotZone, summarizeShotZones } from './shot-zones';

test('sparse or single-area questions open on shots while broad samples open on zones', () => {
	const single = { index: 0, shot: { locX: 0, locY: 10, made: true } };
	assert.equal(preferredShotView([single]), 'shots');
	assert.equal(preferredShotView(Array.from({ length: 60 }, (_, index) => ({ ...single, index }))), 'shots');
	assert.equal(preferredShotView(Array.from({ length: 60 }, (_, index) => ({ index, shot: { locX: 0, locY: [10, 100, 300][index % 3], made: true } }))), 'zones');
});

test('zone denominators retain misses, source indices and explicit two-point values at the arc', () => {
	const shots = [
		{ index: 8, shot: { locX: 0, locY: 10, made: true, value: 2 as const } },
		{ index: 9, shot: { locX: 0, locY: 10, made: false, value: 2 as const } },
		{ index: 20, shot: { locX: -225, locY: 30, made: true, value: 3 as const } },
		{ index: 21, shot: { locX: 225, locY: 30, made: false, value: 3 as const } },
		{ index: 22, shot: { locX: 0, locY: 245, made: false, value: 2 as const } },
		{ index: 23, shot: { locX: 0, locY: 300, made: true, value: 3 as const } },
		{ index: 24, shot: { locX: 0, locY: 700, made: true } }
	];
	const zones = summarizeShotZones(shots);
	assert.equal(zones.reduce((total, zone) => total + zone.attempts, 0), 6);
	assert.equal(zones.find((zone) => zone.key === 'rim')?.percentage, 50);
	assert.deepEqual(zones.find((zone) => zone.key === 'rim')?.shots.map((entry) => entry.index), [8, 9]);
	assert.equal(shotZone(shots[4]), 'mid');
	assert.equal(zones.find((zone) => zone.key === 'right')?.percentage, 0);
	assert.equal(zones.find((zone) => zone.key === 'paint')?.percentage, null);
});

test('zone boundaries classify paint, corners and untyped threes without losing attempts', () => {
	assert.equal(shotZone({ index: 0, shot: { locX: 0, locY: 40, made: false } }), 'rim');
	assert.equal(shotZone({ index: 1, shot: { locX: 80, locY: 142.5, made: true } }), 'paint');
	assert.equal(shotZone({ index: 2, shot: { locX: 220, locY: 92.5, made: false } }), 'right');
	assert.equal(shotZone({ index: 3, shot: { locX: 0, locY: 237.5, made: false } }), 'above');
	assert.equal(shotZone({ index: 4, shot: { locX: NaN, locY: 0, made: false } }), null);
});
