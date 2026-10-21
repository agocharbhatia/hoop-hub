import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shootingFixture, researchUIFixtures } from '$lib/server/research/ui-fixtures';
import { buildShootingExplorer } from '$lib/server/research/shooting-explorer';
import { shootingView } from './shooting-analysis';
import { composeResearch } from './research-composition';
import { artifactCsv, artifactSvg } from './artifact-export';
import { rollingSeries, trendObservationUnit } from './trend-analysis';
import { researchBoardMarkdown } from './research-board-export';
import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';

test('qualification, references and percentiles use the full matching population independently of selection', () => {
	const { plot } = shootingFixture();
	const base = shootingView(plot, { minimumAttempts: 0 });
	const qualified = shootingView(plot, { minimumAttempts: 500, selectedIds: [plot.points[0].id] });
	assert.ok(qualified.points.length < base.points.length);
	const attempts = qualified.points.reduce((sum, point) => sum + point.attempts, 0), makes = qualified.points.reduce((sum, point) => sum + point.makes, 0);
	assert.equal(qualified.attempts, attempts);
	assert.equal(qualified.combinedPercentage, makes / attempts * 100);
	assert.deepEqual(shootingView(plot, { minimumAttempts: 500, selectedIds: [] }), qualified);
	assert.ok(qualified.points.every(point => point.percentile >= 0 && point.percentile <= 100));
	assert.equal(shootingView(plot, { minimumAttempts: 100_000 }).combinedPercentage, null);
	assert.deepEqual(plot, shootingFixture().plot);
});

test('totals and per-game volume share original makes/attempts and tied efficiencies receive equal midranks', () => {
	const { plot } = shootingFixture();
	const totals = shootingView(plot, { rate: 'Totals', minimumAttempts: 0 }), rates = shootingView(plot, { rate: 'PerGame', minimumAttempts: 0 });
	assert.equal(totals.points[0].volume, plot.points[0].attempts);
	assert.equal(rates.points[0].volume, plot.points[0].attempts / plot.points[0].games);
	assert.equal(totals.combinedPercentage, rates.combinedPercentage);
	const tied = { ...plot, points: plot.points.slice(0, 3).map(point => ({ ...point, attempts: 100, makes: 40 })) };
	assert.deepEqual(shootingView(tied, { minimumAttempts: 0 }).points.map(point => point.percentile), [50, 50, 50]);
});

test('unverified percentage denominators, sampled sources and duplicate populations never become scatter evidence', () => {
	const fixture = shootingFixture();
	assert.equal(buildShootingExplorer(fixture.rows, { ...fixture.source, sampled: true }), null);
	assert.equal(buildShootingExplorer(fixture.rows, { ...fixture.source, request: { ...fixture.source.request, params: { ...fixture.source.request.params as object, PerMode: 'PerGame' } } }), null);
	assert.equal(buildShootingExplorer([...fixture.rows, { ...fixture.rows[0], FG3A: 777 }], fixture.source), null);
	const missing = buildShootingExplorer([{ ...fixture.rows[0], GP: 0 }, ...fixture.rows.slice(1)], fixture.source)!;
	assert.equal(missing.omittedRows, 1);
	assert.equal(missing.points.length, fixture.rows.length - 1);
});

test('composition gives the plot priority and removes its equivalent table while retaining original pin indices', () => {
	const fixture = researchUIFixtures()[0];
	const composed = composeResearch(fixture.response.artifacts, fixture.question);
	assert.equal(composed[0].artifact.type, 'scatter_chart');
	assert.equal(composed[0].role, 'primary');
	assert.equal(composed[0].index, 1);
	assert.equal(composed.filter(entry => entry.role === 'primary').length, 1);
	assert.ok(!composed.some(entry => entry.index === 0));
	assert.ok(composed.some(entry => entry.artifact.type === 'line_chart'));
});

test('different sample populations and charts with additional information survive duplicate suppression', () => {
	const { plot } = shootingFixture();
	const table: Extract<QueryAnswerArtifact, { type: 'table' }> = { type: 'table', shape: 'table', columns: ['name', 'value'], rows: [{ name: 'one', value: 4 }], source: { ...plot.source, population: { sample: 'other' } } };
	assert.equal(composeResearch([table, plot], 'three-point volume and efficiency').length, 2);
	const bar: QueryAnswerArtifact = { type: 'bar_chart', title: 'Other metric', xLabel: 'Name', yLabel: 'Value', bars: [{ label: 'one', value: 5 }], source: table.source };
	assert.equal(composeResearch([table, bar], 'rank by value').length, 2);
	assert.equal(composeResearch([table, { ...bar, bars: [{ label: 'one', value: 4 }] }], 'rank by value').length, 1);
});

test('rolling averages wait for complete windows and restart after missing measurements', () => {
	const series = { name: 'Test', points: [1, 2, 3, 4, 5, Number.NaN, 10, 20, 30].map((y, x) => ({ x, y })) };
	assert.deepEqual(rollingSeries(series, 3).points, [{ x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 8, y: 20 }]);
	assert.throws(() => rollingSeries(series, 0));
	assert.equal(series.points.length, 9);
	assert.equal(trendObservationUnit({ type: 'line_chart', title: 'FG%', xLabel: 'Month', yLabel: 'FG%', series: [] }), 'month');
	assert.equal(trendObservationUnit({ type: 'line_chart', title: 'PTS', xLabel: 'Game date', yLabel: 'PTS', series: [] }), 'game');
});

test('CSV carries full data and provenance, converts percentages once, and neutralizes spreadsheet formulas', () => {
	const table: QueryAnswerArtifact = { type: 'table', shape: 'table', columns: ['name', 'FG_PCT', 'netRating'], rows: [{ name: '=HYPERLINK("https://example.invalid")', FG_PCT: .425, netRating: -4.4 }] };
	const csv = artifactCsv(table, { question: 'Question', citations: [{ source: 'Synthetic QA' }], scope: { seasons: ['2025-26'], playerIds: [], teamIds: [], opponentTeamIds: [] } });
	assert.ok(csv.includes("'=HYPERLINK"));
	assert.ok(csv.includes('42.5'));
	assert.ok(csv.includes(',-4.4,'));
	assert.ok(csv.includes('Synthetic QA'));
	assert.ok(csv.includes('2025-26'));
	const plot = shootingFixture().plot;
	assert.equal(artifactCsv(plot, { view: { minimumAttempts: 0 } }).split('\r\n').length, plot.points.length + 1);
	assert.ok(artifactCsv(plot).includes('Verified request'));
	assert.ok(artifactCsv(plot).includes('PerMode'));
});

test('portable graphics escape user text and keep source, units, sample and selected subjects', () => {
	const plot = shootingFixture().plot;
	const svg = artifactSvg({ ...plot, title: '<script>unsafe</script>' }, { view: { selectedIds: [plot.points[0].id], minimumAttempts: 200 }, citations: [{ source: 'Synthetic QA' }] });
	assert.ok(!svg.includes('<script>'));
	assert.ok(svg.includes('&lt;script&gt;'));
	assert.ok(svg.includes('Synthetic QA'));
	assert.ok(svg.includes('3PA / game'));
	assert.ok(svg.includes('min. 200 3PA'));
	assert.ok(svg.includes(plot.points[0].name));
});

test('board briefs preserve qualification, highlighted subjects, date scope, and personal interpretation', () => {
	const plot = shootingFixture().plot;
	const savedAt = '2026-10-15T00:00:00.000Z';
	const brief = researchBoardMarkdown({
		id: crypto.randomUUID(), title: 'Perimeter study', createdAt: savedAt, updatedAt: savedAt, itemCount: 1,
		items: [{ id: crypto.randomUUID(), createdAt: savedAt, note: 'Check the tradeoff.', artifact: plot,
			view: { minimumAttempts: 500, rate: 'Totals', selectedIds: [plot.points[0].id] }, citations: [{ source: 'Synthetic QA' }],
			scope: { seasons: ['2025-26'], seasonTypes: ['Regular Season'], dateFrom: '2026-01-01', dateTo: '2026-03-31', playerIds: [], teamIds: [], opponentTeamIds: [] }
		}]
	});
	assert.ok(brief.includes('Check the tradeoff.'));
	assert.ok(brief.includes('2026-01-01 through 2026-03-31'));
	assert.ok(brief.includes('minimum 500 3PA'));
	assert.ok(brief.includes('highlights: Stephen Curry'));
	assert.ok(brief.includes(`${shootingView(plot, { minimumAttempts: 500 }).populationCount} qualified players`));
	assert.ok(brief.includes('Synthetic QA'));
});
