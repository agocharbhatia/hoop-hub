import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonDomain, comparisonIntensity, comparisonMetricLabel, comparisonPresentation } from './comparison-presentation';
import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';

test('comparison color supports negative metrics, constant samples and missing values', () => {
	assert.equal(comparisonIntensity(-5, comparisonDomain([-5, 0, 5, null])), 0);
	assert.equal(comparisonIntensity(5, comparisonDomain([-5, 0, 5, null])), 1);
	assert.equal(comparisonIntensity(4, comparisonDomain([4, 4])), .5);
	assert.equal(comparisonIntensity(null, comparisonDomain([0, 1])), null);
	assert.equal(comparisonIntensity(0, comparisonDomain([-1e308, 1e308])), .5);
});

test('long-form comparisons retain metric names and reject incompatible metrics or units', () => {
	const artifact: Extract<QueryAnswerArtifact, { type: 'table' }> = { type: 'table', shape: 'ranking', columns: ['subject', 'metric', 'value'], rows: [
		{ subject: 'Nikola Jokic', metric: 'points_per_game', value: 28 }, { subject: 'Victor Wembanyama', metric: 'points_per_game', value: 24 }
	] };
	assert.deepEqual(comparisonPresentation(artifact)?.metrics, ['value']);
	assert.equal(comparisonMetricLabel(artifact.rows, 'value'), 'Points per game');
	assert.equal(comparisonPresentation({ ...artifact, rows: [artifact.rows[0], { ...artifact.rows[1], metric: 'blocks_per_game' }] }), null);
	assert.equal(comparisonPresentation({ ...artifact, rows: [{ ...artifact.rows[0], unit: '%' }, { ...artifact.rows[1], unit: 'points' }] }), null);
});

test('the verified requested ranking column is the initial prominent metric', () => {
	const artifact: Extract<QueryAnswerArtifact, { type: 'table' }> = { type: 'table', shape: 'ranking', columns: ['player', 'PTS', 'REB'], rows: [
		{ player: 'Nikola Jokic', PTS: 28, REB: 13 }, { player: 'Victor Wembanyama', PTS: 24, REB: 11 }
	], source: { toolName: 'aggregate_endpoint_rows', endpointId: 'test', resultSetName: 'test', request: { orderBy: { column: 'REB', direction: 'desc' } } } };
	assert.deepEqual(comparisonPresentation(artifact)?.metrics, ['REB', 'PTS']);
});

test('comparison eligibility rejects event identities, mixed fields and duplicate populations', () => {
	const artifact: Extract<QueryAnswerArtifact, { type: 'table' }> = {
		type: 'table', shape: 'comparison', columns: ['player', 'PLAYER_ID', 'PTS', 'FG_PCT', 'GP'],
		rows: [{ player: 'Nikola Jokic', PLAYER_ID: 203999, PTS: 27, FG_PCT: .58, GP: 70 }, { player: 'Victor Wembanyama', PLAYER_ID: 1641705, PTS: 24, FG_PCT: .5, GP: 64 }]
	};
	assert.deepEqual(comparisonPresentation(artifact), { identity: 'player', metrics: ['PTS', 'FG_PCT'] });
	assert.equal(comparisonPresentation({ ...artifact, rows: [artifact.rows[0], artifact.rows[0]] }), null);
	assert.equal(comparisonPresentation({ ...artifact, rows: [{ ...artifact.rows[0], player: 'Unknown event' }, artifact.rows[1]] }), null);
	assert.deepEqual(comparisonPresentation({ ...artifact, rows: [{ ...artifact.rows[0], PTS: '27' }, artifact.rows[1]] })?.metrics, ['FG_PCT']);
});
