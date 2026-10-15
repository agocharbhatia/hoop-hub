import assert from 'node:assert/strict';
import { test } from 'node:test';
import { presentTable, type TableArtifact } from '$lib/presentation/table-display';
import { buildEntityComparison, comparisonDelta } from './entity-comparison';

const fixture = (): TableArtifact => presentTable({ type: 'table', shape: 'comparison', columns: ['player', 'GP', 'PTS', 'AST', 'TOV', 'TS_PCT', 'FGA', 'FTA'], rows: [
	{ player: 'Scottie Barnes', GP: 68, PTS: 22.4, AST: 5.8, TOV: 2.4, TS_PCT: .582, FGA: 17.4, FTA: 4.3 },
	{ player: 'Jayson Tatum', GP: 65, PTS: 26.8, AST: 4.9, TOV: 3.1, TS_PCT: .61, FGA: 19.5, FTA: 5.5 }
] }, { perMode: 'PerGame', metrics: ['PTS', 'AST', 'TOV', 'TS_PCT'] });

test('paired rows keep signed direction separate from favorable direction and show percentage-point deltas', () => {
	const comparison = buildEntityComparison(fixture())!;
	assert.equal(comparison.kind, 'player');
	const points = comparisonDelta(comparison.metrics.find(metric => metric.key === 'PTS')!);
	assert.equal(points.text, '−4.4'); assert.equal(points.higher, 1); assert.equal(points.tone, 'negative');
	const turnovers = comparisonDelta(comparison.metrics.find(metric => metric.key === 'TOV')!);
	assert.equal(turnovers.text, '−0.7'); assert.equal(turnovers.higher, 1); assert.equal(turnovers.tone, 'positive');
	assert.equal(comparisonDelta(comparison.metrics.find(metric => metric.key === 'TS_PCT')!).text, '−2.8 pp');
	assert.deepEqual(comparison.metrics.find(metric => metric.key === 'TS_PCT')!.support.map(row => row.label), ['Points', 'FGA', 'FTA']);
});

test('team comparisons use the same rows and respect lower-is-favorable defensive rating', () => {
	const comparison = buildEntityComparison(presentTable({ type: 'table', shape: 'comparison', columns: ['teamName', 'GP', 'offensiveRating', 'defensiveRating', 'netRating'], rows: [
		{ teamName: 'Toronto Raptors', GP: 82, offensiveRating: 116, defensiveRating: 109, netRating: 7 },
		{ teamName: 'Boston Celtics', GP: 80, offensiveRating: 118, defensiveRating: 112, netRating: 6 }
	] }))!;
	assert.equal(comparison.kind, 'team');
	assert.equal(comparison.subjects[0].entity.kind, 'team');
	const defense = comparisonDelta(comparison.metrics.find(metric => metric.key === 'defensiveRating')!);
	assert.equal(defense.text, '−3.0'); assert.equal(defense.tone, 'positive');
});

test('long-form multi-metric comparisons pivot without mixing units or populations', () => {
	const table: TableArtifact = { type: 'table', shape: 'comparison', columns: ['subject', 'metric', 'value', 'unit'], rows: [
		{ subject: 'Scottie Barnes', metric: 'pts', value: 22, unit: 'points / game' }, { subject: 'Scottie Barnes', metric: 'fg_pct', value: 45, unit: '%' },
		{ subject: 'Jayson Tatum', metric: 'pts', value: 27, unit: 'points / game' }, { subject: 'Jayson Tatum', metric: 'fg_pct', value: 50, unit: '%' }
	] };
	const comparison = buildEntityComparison(table)!;
	assert.deepEqual(comparison.metrics.map(metric => metric.label), ['Points', 'FG%']);
	assert.equal(comparisonDelta(comparison.metrics[1]).text, '−5.0 pp');
	assert.equal(buildEntityComparison({ ...table, rows: [...table.rows, { ...table.rows[0], season: '2024-25' }] }), null);
	assert.equal(buildEntityComparison({ ...table, rows: table.rows.map((row, i) => i === 2 ? { ...row, unit: 'points / 100 possessions' } : row) }), null);
});

test('missing data stays unavailable and tracked matchups and event rows retain their own presentation', () => {
	const missing = fixture(); missing.rows[1].PTS = null;
	assert.equal(comparisonDelta(buildEntityComparison(missing)!.metrics.find(metric => metric.key === 'PTS')!).text, '—');
	assert.equal(buildEntityComparison({ ...fixture(), shape: 'ranking' }), null);
	assert.equal(buildEntityComparison({ ...fixture(), columns: [...fixture().columns, 'GAME_ID'] }), null);
	assert.equal(buildEntityComparison({ ...fixture(), columns: [...fixture().columns, 'GAME_DATE'] }), null);
	assert.equal(buildEntityComparison({ ...fixture(), columns: [...fixture().columns, 'defensivePlayer'] }), null);
	assert.equal(buildEntityComparison({ ...fixture(), columns: [...fixture().columns, 'metric', 'earlierAverage', 'recentAverage'] }), null);
});

test('aliases for one entity and contradictory identity fields never become a two-entity comparison', () => {
	const table = fixture();
	table.rows[1].player = 'scottIe barnes';
	assert.equal(buildEntityComparison(table), null);
	table.rows[1].player = 'Jayson Tatum';
	table.rows[1].PLAYER_ID = 1630567;
	assert.equal(buildEntityComparison(table), null);
});

test('a missing long-form metric keeps its known unit but never fabricates a value or delta', () => {
	const table: TableArtifact = { type: 'table', shape: 'comparison', columns: ['subject', 'metric', 'value', 'unit'], rows: [
		{ subject: 'Scottie Barnes', metric: 'pts', value: 22, unit: 'points / game' },
		{ subject: 'Jayson Tatum', metric: 'pts', value: 27, unit: 'points / game' },
		{ subject: 'Jayson Tatum', metric: 'ast', value: 5, unit: 'assists / game' }
	] };
	const comparison = buildEntityComparison(table)!;
	const assists = comparison.metrics.find(metric => metric.key === 'ast')!;
	assert.equal(assists.cells[0].value, null);
	assert.equal(assists.unit, 'assists / game');
	assert.equal(comparisonDelta(assists).text, '—');
});

test('equal, negative and tiny values do not invent a winner or hide exact differences', () => {
	const table = fixture(); table.rows[1].AST = table.rows[0].AST;
	const metric = buildEntityComparison(table)!.metrics.find(metric => metric.key === 'AST')!;
	assert.equal(comparisonDelta(metric).higher, null);
	assert.equal(comparisonDelta(metric).tone, 'neutral');
	metric.cells[0].value = 4.441; metric.cells[1].value = 4.449;
	assert.equal(comparisonDelta(metric).text, '−<0.1');
});
