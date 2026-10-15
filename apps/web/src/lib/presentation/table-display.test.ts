import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTableDisplay, presentTable, type TableArtifact } from './table-display';
import { buildTablePresentation, formatTableCell } from '$lib/components/charts/table-utils';

test('the requested ranking leads with its metric and denominator even when source columns are shuffled', () => {
	const artifact: TableArtifact = { type: 'table', shape: 'ranking', columns: ['PLAYER_ID', 'FG_PCT', 'GP', 'FG3A', 'AST', 'PLAYER_NAME', 'rank', 'FG3_PCT', 'FG3M'], rows: [{ PLAYER_ID: 1, PLAYER_NAME: 'Scottie Barnes', rank: 1, GP: 50, FG_PCT: .45, FG3_PCT: .39, FG3A: 100, FG3M: 39, AST: 5 }], source: { toolName: 'aggregate_endpoint_rows', endpointId: 'league', resultSetName: 'league', request: { params: { PerMode: 'Totals' }, orderBy: { column: 'FG3_PCT', direction: 'desc' } } } };
	const display = buildTableDisplay(artifact, { question: 'Rank three-point percentage' });
	assert.deepEqual(display.primaryColumns.slice(0, 5), ['rank', 'PLAYER_NAME', 'FG3_PCT', 'FG3M', 'FG3A']);
	assert.equal(display.metricColumns[0], 'FG3_PCT');
	assert.equal(formatTableCell(.39, { column: 'FG3_PCT', display }), '39%');
	assert.ok(!display.primaryColumns.includes('PLAYER_ID'));
	assert.equal(display.primaryColumns[5], 'GP');
	assert.ok(!display.primaryColumns.includes('AST'));
	const presentation = buildTablePresentation(artifact.columns, artifact.rows, display);
	assert.deepEqual(presentation.primaryColumns, display.primaryColumns);
	assert.ok(presentation.detailColumns.includes('PLAYER_ID'));
});

test('old saved tables use the question to prioritize available fields without rescaling unknown metrics', () => {
	const artifact: TableArtifact = { type: 'table', shape: 'table', columns: ['opaqueRatio', 'FG_PCT', 'AST', 'PLAYER_NAME', 'REB', 'PTS', 'GP'], rows: [{ PLAYER_NAME: 'Scottie Barnes', opaqueRatio: .42, FG_PCT: .5, AST: 6, REB: 8, PTS: 22, GP: 60 }] };
	const display = buildTableDisplay(artifact, { question: 'Show rebounds and assists' });
	assert.deepEqual(display.primaryColumns.slice(0, 3), ['PLAYER_NAME', 'REB', 'AST']);
	assert.equal(formatTableCell(.42, { column: 'opaqueRatio', display }), '0.42');
	assert.equal(display.columns.PTS.unit, 'points');
});

test('verified per-game and per-possession units survive serialization without altering source rows', () => {
	const artifact: TableArtifact = { type: 'table', shape: 'comparison', columns: ['subject', 'PTS', 'TS_PCT'], rows: [{ subject: 'Scottie Barnes', PTS: 22.397, TS_PCT: .582 }, { subject: 'Jayson Tatum', PTS: 26.8, TS_PCT: .61 }] };
	const before = structuredClone(artifact);
	const presented = presentTable(artifact, { metrics: ['TS_PCT', 'PTS'], perMode: 'PerGame' });
	const restored = JSON.parse(JSON.stringify(presented)) as TableArtifact;
	assert.equal(restored.display?.columns.PTS.unit, 'points / game');
	assert.equal(formatTableCell(restored.rows[0].PTS, { column: 'PTS', row: restored.rows[0], display: restored.display }), '22.4');
	assert.equal(formatTableCell(restored.rows[0].TS_PCT, { column: 'TS_PCT', display: restored.display }), '58.2%');
	assert.equal(buildTableDisplay(artifact, { perMode: 'Per100Possessions' }).columns.PTS.unit, 'points / 100 poss.');
	assert.deepEqual(artifact, before);
});

test('long-form metrics derive their declared units and preserve percentage versus percentage-point semantics', () => {
	const artifact: TableArtifact = { type: 'table', shape: 'comparison', columns: ['value', 'metric', 'subject'], rows: [{ subject: 'Scottie Barnes', metric: 'fg_pct', value: .4 }, { subject: 'Jayson Tatum', metric: 'fg_pct', value: .45 }] };
	const display = buildTableDisplay(artifact);
	assert.deepEqual(display.primaryColumns.slice(0, 3), ['subject', 'metric', 'value']);
	assert.equal(buildTablePresentation(['metric', 'value', 'subject'], artifact.rows, display).identityColumn, 'subject');
	assert.equal(formatTableCell(.4, { column: 'value', row: artifact.rows[0], display }), '40%');
	assert.equal(formatTableCell(.05, { column: 'change', row: artifact.rows[0], display }), '+5 pp');
});

test('FG% question intent matches endpoint aliases without conflating their percentage scales', () => {
	for (const [column, sourceValue] of [['FG_PCT', .425], ['fgPercent', 42.5]] as const) {
		const artifact: TableArtifact = { type: 'table', shape: 'table', columns: ['AST', column, 'subject', 'attempts', 'makes'], rows: [{ subject: 'Scottie Barnes', [column]: sourceValue, AST: 6, attempts: 40, makes: 17 }] };
		const display = buildTableDisplay(artifact, { question: 'Compare FG%' });
		assert.deepEqual(display.primaryColumns, ['subject', column, 'makes', 'attempts']);
		assert.deepEqual(display.metricColumns, [column]);
		assert.equal(formatTableCell(sourceValue, { column, display }), '42.5%');
	}
});

test('derived columns retain the underlying metric and units', () => {
	const artifact: TableArtifact = { type: 'table', shape: 'table', columns: ['subject', 'sum:REB', 'avg:AST'], rows: [{ subject: 'Scottie Barnes', 'sum:REB': 40, 'avg:AST': 5.75 }] };
	const display = buildTableDisplay(artifact, { question: 'Average assists' });
	assert.equal(display.primaryColumns[1], 'avg:AST');
	assert.equal(display.columns['avg:AST'].label, 'Avg. Assists');
	assert.equal(display.columns['avg:AST'].unit, 'assists');
	const split = buildTableDisplay({ type: 'table', shape: 'comparison', columns: ['result', 'games', 'ptsPerGame'], rows: [{ result: 'Wins', games: 12, ptsPerGame: 22.5 }] }, { question: 'Points per game in wins' });
	assert.equal(split.columns.ptsPerGame.unit, 'points / game');
	assert.deepEqual(split.metricColumns, ['ptsPerGame']);
});

test('team semantic intent labels teams and preserves rating units alongside per-game stats', () => {
	const artifact: TableArtifact = { type: 'table', shape: 'ranking', columns: ['subject', 'PTS', 'DEF_RATING'], rows: [{ subject: 'Toronto Raptors', PTS: 116, DEF_RATING: 109 }] };
	const display = buildTableDisplay(artifact, { entity: 'team', perMode: 'PerGame' });
	assert.equal(display.columns.subject.label, 'Team');
	assert.equal(display.columns.PTS.unit, 'points / game');
	assert.equal(display.columns.DEF_RATING.unit, 'points / 100 possessions');
	assert.equal(display.columns.DEF_RATING.preferredDirection, 'lower');
});

test('explicitly requested metrics retain supporting denominators and all relevant game samples', () => {
	const artifact: TableArtifact = { type: 'table', shape: 'ranking', columns: ['rank', 'offensivePlayer', 'fgPct', 'fgm', 'fga', 'games', 'partialPossessions', 'turnovers'], rows: [{ rank: 1, offensivePlayer: 'Jayson Tatum', fgPct: .4, fgm: 4, fga: 10, games: 2, partialPossessions: 40, turnovers: 2 }] };
	assert.deepEqual(buildTableDisplay(artifact, { metrics: ['fgPct'] }).primaryColumns, ['rank', 'offensivePlayer', 'fgPct', 'fgm', 'fga', 'games', 'partialPossessions']);
});
