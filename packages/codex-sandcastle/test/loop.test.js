import assert from 'node:assert/strict';
import test from 'node:test';
import { renderLoopCycleBanner } from '../src/loop.js';

test('renderLoopCycleBanner creates a framed plain-text block when color is disabled', () => {
	const banner = renderLoopCycleBanner({
		round: 2,
		maxRounds: 5,
		phase: 'START',
		tone: 'start',
		details: ['Stage flow: planner -> workers -> merger'],
		useColor: false
	});

	assert.equal(banner.includes('\u001B['), false);
	assert.match(banner, /SANDCASTLE LOOP CYCLE 2\/5 START/);
	assert.match(banner, /Stage flow: planner -> workers -> merger/);

	const lines = banner.trim().split('\n');
	assert.equal(lines[0].startsWith('='), true);
	assert.equal(lines.at(-1).startsWith('='), true);
	assert.equal(new Set(lines.map((line) => line.length)).size, 1);
});

test('renderLoopCycleBanner uses distinct ANSI themes for start and complete blocks', () => {
	const startBanner = renderLoopCycleBanner({
		round: 1,
		maxRounds: 3,
		phase: 'START',
		tone: 'start',
		useColor: true
	});
	const completeBanner = renderLoopCycleBanner({
		round: 1,
		maxRounds: 3,
		phase: 'COMPLETE',
		tone: 'complete',
		details: ['Summary: selected 2 | ready 1 | merged 1'],
		useColor: true
	});

	assert.match(startBanner, /\u001B\[1;30;106m/);
	assert.match(completeBanner, /\u001B\[1;30;102m/);
	assert.notEqual(startBanner, completeBanner);
});
