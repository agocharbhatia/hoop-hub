import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryAnswerArtifact, QueryArtifactSource } from '$lib/contracts/answer-response';
import { displayMetric, possessionView, presentationArtifacts, rankingMetric, sharedSample } from './possession-presentation';

/* Canonical population fixtures */
const source: QueryArtifactSource = { toolName: 'analyze_possession_stats', providerId: 'pbpstats', endpointId: 'pbpstats:on_off', resultSetName: 'on_off', request: { season: '2025-26', playerIds: ['1630567'], teamId: '1610612761' }, population: { returnedRows: 11 } };
const comparison: QueryAnswerArtifact = { type: 'table', shape: 'comparison', columns: ['metric', 'unit', 'on', 'off', 'difference'], rows: [{ metric: 'Net rating', unit: 'points / 100 possessions', on: 4.44, off: 1.727, difference: 2.713 }], source };
const chart: QueryAnswerArtifact = { type: 'bar_chart', title: 'Net rating', xLabel: 'Court', yLabel: 'Net points / 100 possessions', bars: [{ label: 'On court', value: 4.44 }, { label: 'Off court', value: 1.727 }], source };
/* End canonical population fixtures */

test('comparison presentation replaces only charts from the exact verified population', () => {
	const differentSeason = { ...chart, source: { ...source, request: { ...source.request, season: '2024-25' } } };
	const differentCoverage = { ...chart, source: { ...source, population: { returnedRows: 3 } } };
	const plainChart = { ...chart, source: undefined };
	const playlist: QueryAnswerArtifact = { type: 'video_playlist', title: 'Clips', clips: [] };
	const raw = [comparison, chart, differentSeason, differentCoverage, plainChart, playlist];
	const before = structuredClone(raw);
	assert.deepEqual(presentationArtifacts(raw).map(({ index }) => index), [0, 2, 3, 4, 5]);
	assert.deepEqual(raw, before);
	assert.equal(presentationArtifacts(raw).at(-1)?.index, 5, 'Export and event selection retain original indices');
});

test('saved malformed or unverified tables keep their generic table and chart', () => {
	for (const table of [{ ...comparison, columns: ['metric', 'on'] }, { ...comparison, source: { ...source, providerId: 'nba_stats' as const } }, { ...comparison, rows: [{ metric: 'Net rating', unit: 'points', on: 'invalid', off: 1, difference: 2 }] }]) {
		assert.equal(possessionView(table), null);
		assert.equal(presentationArtifacts([table, chart]).length, 2);
	}
	const equivalent = { ...chart, source: { ...source, request: { teamId: '1610612761', playerIds: ['1630567'], season: '2025-26' } } };
	assert.equal(presentationArtifacts([comparison, equivalent]).length, 1);
});

test('samples are shared only when every metric has the same finite sample', () => {
	assert.equal(sharedSample([{ minutesOn: 2614 }, { minutesOn: 2614 }], 'minutesOn'), 2614);
	assert.equal(sharedSample([{ minutesOn: 2614 }, { minutesOn: 1200 }], 'minutesOn'), null);
	assert.equal(sharedSample([{ minutesOn: 2614 }, { minutesOn: null }], 'minutesOn'), null);
	assert.equal(sharedSample([], 'minutesOn'), null);
});

test('possession-ranked lineups retain their actual ranking metric even when it is hidden from table columns', () => {
	const lineup: QueryAnswerArtifact = { type: 'table', shape: 'comparison', columns: ['lineup', 'offensiveRating', 'defensiveRating', 'netRating', 'minutes'], rows: [{ lineup: 'Five players', offensiveRating: 114, defensiveRating: 110, netRating: 4, minutes: 22, possessions: 47 }], source: { ...source, resultSetName: 'lineups', endpointId: 'pbpstats:lineups', request: { ...source.request, metric: 'possessions' } } };
	assert.equal(possessionView(lineup), 'lineups');
	assert.equal(rankingMetric(lineup), 'possessions');
	assert.equal(lineup.rows[0][rankingMetric(lineup)], 47);
});

test('display precision preserves signs and percentage units without turning missing values into zero', () => {
	assert.equal(displayMetric(0.7754, { signed: true }), '+0.8');
	assert.equal(displayMetric(54.4683, { percentage: true }), '54.5%');
	assert.equal(displayMetric(-1.4695, { signed: true }), '-1.5');
	assert.equal(displayMetric(-0.0001, { signed: true }), '0.0');
	assert.equal(displayMetric(null), 'N/A');
});
