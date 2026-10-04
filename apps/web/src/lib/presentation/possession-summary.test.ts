import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import { presentResearchAnswer } from './possession-summary';
import { buildPossessionTakeaway } from './possession-takeaway';

/* Saved-response fixtures */

const request = { mode: 'on_off', teamId: '1610612761', playerIds: ['1630567'], season: '2025-26', seasonType: 'Regular Season', metric: 'netRating', direction: 'desc', minPossessions: 0, minMinutes: 0 };
const rows = [
	{ metric: 'Offensive rating', unit: 'points / 100 possessions', on: 117.259, off: 113.651, difference: 3.608, minutesOn: 2614, minutesOff: 1246 },
	{ metric: 'Defensive rating', unit: 'points / 100 possessions', on: 112.819, off: 111.924, difference: 0.895, minutesOn: 2614, minutesOff: 1246 },
	{ metric: 'Net rating', unit: 'points / 100 possessions', on: 4.44, off: 1.727, difference: 2.713, minutesOn: 2614, minutesOff: 1246 }
];
const legacy = 'Toronto Raptors · 2025-26 Regular Season · on off · Scottie Barnes\nOffensive rating: 117.26 on court vs 113.65 off court (3.61 on minus off), in points per 100 possessions.\nDefensive rating: 112.82 on court vs 111.92 off court (0.90 on minus off), in points per 100 possessions.\nNet rating: 4.44 on court vs 1.73 off court (2.71 on minus off), in points per 100 possessions.\nSample: 2614.00 minutes on court and 1246.00 off court. Lower defensive rating means fewer points allowed.';
const result: QueryAnswerResponse = {
	status: 'ok', answer: legacy, toolResults: [], citations: [], warnings: [], traceId: 'summary',
	artifacts: [{ type: 'table', shape: 'comparison', columns: Object.keys(rows[0]), rows,
		source: { providerId: 'pbpstats', toolName: 'analyze_possession_stats', endpointId: 'pbpstats:on_off', resultSetName: 'on_off', request } }]
};

/* End saved-response fixtures */

test('replaces repeated legacy numerical prose with one directional takeaway', () => {
	const summary = presentResearchAnswer({ ...result, answer: [legacy, legacy, legacy].join('\n\n') });
	assert.equal(summary, 'In the 2025-26 regular season, the Toronto Raptors had a higher net rating with Scottie Barnes on the court.');
	assert.doesNotMatch(summary, /117\.26|4\.44|2614/);
});

test('retains unique explanation, unverifiable prose and missing-data messages', () => {
	const unique = 'The difference is descriptive and can reflect the other players on the court.';
	assert.ok(presentResearchAnswer({ ...result, answer: `${legacy}\n\n${unique}` }).endsWith(unique));
	const changed = legacy.replace('117.26', '999.00');
	assert.equal(presentResearchAnswer({ ...result, answer: changed }), changed);
	assert.equal(presentResearchAnswer({ ...result, status: 'coverage_gap' }), legacy);
	assert.equal(presentResearchAnswer({ ...result, artifacts: [] }), legacy);
	assert.equal(presentResearchAnswer({ ...result, answer: 'The playoff comparison is unavailable.' }), 'The playoff comparison is unavailable.');
});

test('takeaways compare net-rating values without attributing causation and retain season scope', () => {
	const names = { team: 'Toronto Raptors', players: ['Scottie Barnes'] };
	assert.match(buildPossessionTakeaway(request, [{ metric: 'Net rating', on: 1, off: 3 }], names), /lower net rating/);
	assert.match(buildPossessionTakeaway({ ...request, season: '2024-25' }, [{ metric: 'Net rating', on: 3, off: 3 }], names), /2024-25.*the same net rating/);
	assert.doesNotMatch(buildPossessionTakeaway(request, [{ metric: 'Net rating', on: null, off: 3 }], names), /higher|lower|same/);
});
