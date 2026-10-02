import assert from 'node:assert/strict';
import { test } from 'node:test';
import { binShots, isOnCourt, summarizeShots, type IndexedShot } from './shot-chart-utils';
import { sortTableRows } from './table-utils';
import { collectChartXValues, niceTicks, resolveValueDomain } from './chart-utils';

test('heatmaps keep attempts and makes together, including exact court boundaries', () => {
	const shots: IndexedShot[] = [
		{ index: 0, shot: { locX: 0, locY: 0, made: true } },
		{ index: 1, shot: { locX: 0, locY: 0, made: false } },
		{ index: 2, shot: { locX: 250, locY: 422.5, made: true } },
		{ index: 3, shot: { locX: 251, locY: 0, made: true } }
	];
	const bins = binShots(shots);
	assert.equal(bins.reduce((count, bin) => count + bin.attempts, 0), 3);
	assert.equal(bins.find((bin) => bin.attempts === 2)?.percentage, 50);
	assert.equal(bins.find((bin) => bin.key === '9:9')?.makes, 1);
	assert.equal(isOnCourt({ locX: NaN, locY: 0, made: true }), false);
});

test('heatmaps distinguish an empty sample from a zero-percent shooting sample', () => {
	assert.deepEqual(binShots([]), []);
	const [bin] = binShots([{ index: 0, shot: { locX: 0, locY: 0, made: false } }]);
	assert.equal(bin.attempts, 1);
	assert.equal(bin.percentage, 0);
});

test('full-sample FG summary retains off-court attempts that heatmap bins cannot plot', () => {
	const shots = [{ locX: 0, locY: 0, made: true }, { locX: 0, locY: 700, made: false }];
	assert.deepEqual(summarizeShots(shots), { attempts: 2, makes: 1, percentage: 50 });
	assert.equal(binShots(shots.map((shot, index) => ({ shot, index }))).reduce((sum, bin) => sum + bin.attempts, 0), 1);
});

test('table sorting is numerical, stable and keeps missing values last in both directions', () => {
	const rows = [null, 10, 2, 10].map((value, index) => ({ index, row: { value } }));
	assert.deepEqual(sortTableRows(rows, 'value', 'ascending').map((entry) => entry.index), [2, 1, 3, 0]);
	assert.deepEqual(sortTableRows(rows, 'value', 'descending').map((entry) => entry.index), [1, 3, 2, 0]);
	assert.deepEqual(rows.map((entry) => entry.index), [0, 1, 2, 3]);
});

test('categorical table sorting handles numbered labels without losing source identity', () => {
	const rows = ['Game 12', 'Game 2'].map((subject, index) => ({ index, row: { subject } }));
	assert.deepEqual(sortTableRows(rows, 'subject', 'ascending').map((entry) => entry.index), [1, 0]);
});

test('empty and invalid chart domains remain finite and negative-only data includes zero', () => {
	assert.deepEqual(resolveValueDomain([]), { min: 0, max: 1 });
	assert.deepEqual(resolveValueDomain([NaN, Infinity]), { min: 0, max: 1 });
	const domain = resolveValueDomain([-5, -5]);
	assert.ok(domain.min < -5 && domain.max > 0);
	assert.deepEqual(niceTicks(NaN, Infinity), []);
});

test('partial comparison series merge by time while categorical labels retain their intended order', () => {
	const series = [
		{ points: [{ x: '2026-01-01', y: 20 }, { x: '2026-01-03', y: 30 }] },
		{ points: [{ x: '2026-01-02', y: 25 }, { x: '2026-01-03', y: 31 }] }
	];
	assert.deepEqual(collectChartXValues(series), ['2026-01-01', '2026-01-02', '2026-01-03']);
	assert.deepEqual(collectChartXValues([{ points: [{ x: 3, y: 1 }, { x: 1, y: 1 }] }]), [1, 3]);
	assert.deepEqual(collectChartXValues([{ points: [{ x: 'Wins', y: 1 }, { x: 'Losses', y: 1 }] }]), ['Wins', 'Losses']);
});
