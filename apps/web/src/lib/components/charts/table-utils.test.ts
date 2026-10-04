import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTablePresentation, formatTableCell, sortTableRows, tableMetricUnit } from './table-utils';

test('row percentage units attach to values and differences retain percentage-point semantics', () => {
	const row = { metric: 'Offense · Effective FG%', unit: '%', on: 54.4683, off: 53.6929, difference: .7754 };
	assert.equal(formatTableCell(row.on, { row, column: 'on' }), '54.5%');
	assert.equal(formatTableCell(row.off, { row, column: 'off' }), '53.7%');
	assert.equal(formatTableCell(row.difference, { row, column: 'difference' }), '0.8 pp');
	assert.equal(tableMetricUnit(row, 'metric'), null);
	assert.equal(row.on, 54.4683);
});

test('ratings use one decimal and put their longer unit beside the metric label', () => {
	const row = { metric: 'Net rating', unit: 'points / 100 possessions', on: 4.44, off: 1.727, difference: 2.713 };
	assert.equal(formatTableCell(row.on, { row, column: 'on' }), '4.4');
	assert.equal(formatTableCell(row.difference, { row, column: 'difference' }), '2.7');
	assert.equal(tableMetricUnit(row, 'metric'), 'points / 100 possessions');
	assert.equal(tableMetricUnit(row, 'on'), null);
});

test('known canonical NBA percentages convert fractions while arbitrary value columns keep their scale', () => {
	assert.equal(formatTableCell(.286, { column: 'fgPct' }), '28.6%');
	assert.equal(formatTableCell(1, { column: 'FG3_PCT' }), '100%');
	assert.equal(formatTableCell(.286, { column: 'value' }), '0.29');
	assert.equal(formatTableCell(.286, { row: { unit: '%' }, column: 'value' }), '0.3%');
	assert.equal(formatTableCell(null, { column: 'fgPct' }), '-');
});

test('a row unit remains visible as an ordinary field when no metric label can carry it', () => {
	const rows = [{ value: 42, unit: '%' }, { value: 25, unit: '%' }];
	assert.deepEqual(buildTablePresentation(['value', 'unit'], rows).columns, ['value', 'unit']);
});

test('repeated shared context moves to a caption while equal statistics remain in the table', () => {
	const rows = [
		{ metric: 'Offensive rating', unit: 'points / 100 possessions', on: 117.259, off: 113.651, minutesOn: 2614, minutesOff: 1215, games: 82 },
		{ metric: 'Defensive rating', unit: 'points / 100 possessions', on: 112.819, off: 111.924, minutesOn: 2614, minutesOff: 1215, games: 82 }
	];
	const columns = Object.keys(rows[0]);
	const presentation = buildTablePresentation(columns, rows);
	assert.deepEqual(presentation.context, [{ column: 'minutesOn', value: 2614 }, { column: 'minutesOff', value: 1215 }]);
	assert.ok(!presentation.columns.includes('unit'));
	assert.ok(presentation.columns.includes('games'));
	assert.equal(presentation.identityColumn, 'metric');
	assert.deepEqual(columns, Object.keys(rows[0]));
});

test('changing or missing sample metadata stays attached to its original row', () => {
	const rows = [{ metric: 'Offense', minutesOn: 100 }, { metric: 'Defense', minutesOn: 200 }];
	assert.ok(buildTablePresentation(['metric', 'minutesOn'], rows).columns.includes('minutesOn'));
	const partial = [{ metric: 'Offense', minutesOn: 100 }, { metric: 'Defense', minutesOn: null }];
	assert.deepEqual(buildTablePresentation(['metric', 'minutesOn'], partial).context, []);
	assert.deepEqual(buildTablePresentation(['metric', 'minutesOn'], rows.slice(0, 1)).context, []);
});

test('wide tables prioritize useful stats while every remaining field stays in row details', () => {
	const columns = ['rank', 'offensivePlayer', 'defensivePlayer', 'games', 'matchupMinutes', 'partialPossessions', 'points', 'fgm', 'fga', 'fgPct', 'fg3m', 'fg3a', 'fg3Pct', 'assists', 'turnovers'];
	const rows = [{ offensivePlayer: 'Jayson Tatum', defensivePlayer: 'Scottie Barnes', fgPct: .4, games: 3, fga: 10 }];
	const presentation = buildTablePresentation(columns, rows);
	assert.equal(presentation.identityColumn, 'offensivePlayer');
	assert.equal(presentation.primaryColumns.length, 6);
	assert.ok(presentation.primaryColumns.includes('fgPct'));
	assert.ok(presentation.primaryColumns.includes('fga'));
	assert.deepEqual([...presentation.primaryColumns, ...presentation.detailColumns].sort(), [...columns].sort());
});

test('rounding cannot change rank order or row identity and more precision retains source detail', () => {
	const rows = [{ index: 0, row: { netRating: 4.441 } }, { index: 1, row: { netRating: 4.449 } }];
	assert.equal(formatTableCell(rows[0].row.netRating, { column: 'netRating' }), formatTableCell(rows[1].row.netRating, { column: 'netRating' }));
	assert.deepEqual(sortTableRows(rows, 'netRating', 'descending').map(({ index }) => index), [1, 0]);
	assert.equal(formatTableCell(117.259, { column: 'offensiveRating', exact: true }), '117.259');
	assert.equal(formatTableCell(.0000000000001, { exact: true }), '1e-13');
	assert.equal(formatTableCell(Number.NaN), '-');
});
