import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { QueryAnswerAgentToolResult } from '$lib/contracts/answer-response';
import { buildSeasonComparisonTables } from './season-comparison';

describe('grounded season comparison evidence', () => {
	test('uses the resolved player name when event rows contain only identifiers', () => {
		const artifacts = buildSeasonComparisonTables([shotAggregate('2024-25', '1630567', 'Mid-Range', 2, 1)],
			[{ id: '1630567', canonicalName: 'Scottie Barnes', teamId: null }]);
		const table = artifacts.find((artifact) => artifact.type === 'table');
		assert.equal(table?.rows[0].scope, 'Scottie Barnes · Mid-Range');
	});
	test('pairs each player and filter population independently across seasons', () => {
		const results = [
			shotAggregate('2025-26', '1', 'Mid-Range', 4, 2),
			shotAggregate('2025-26', '2', 'Restricted Area', 5, 4),
			shotAggregate('2023-24', '1', 'Mid-Range', 10, 6),
			shotAggregate('2023-24', '2', 'Restricted Area', 4, 3)
		];
		const artifacts = buildSeasonComparisonTables(results);
		const tables = artifacts.filter((artifact) => artifact.type === 'table');
		assert.equal(tables.length, 2);
		assert.deepEqual(tables.map((table) => table.rows.map((row) => [row.season, row.sampleSize, row.fgPct])), [
			[['2025-26', 4, 0.5], ['2023-24', 10, 0.6]],
			[['2025-26', 5, 0.8], ['2023-24', 4, 0.75]]
		]);
		assert.match(String(tables[0].rows[0].scope), /Player 1.*Mid-Range/);
		assert.match(String(tables[1].rows[0].scope), /Player 2.*Restricted Area/);
		const bars = artifacts.filter((artifact) => artifact.type === 'bar_chart');
		assert.deepEqual(bars.map((chart) => chart.bars.map((bar) => bar.value)), [[50, 60], [80, 75]]);
	});

	test('retains normalized raw rows as season-labelled comparison tables and identifies sampled evidence', () => {
		const artifacts = buildSeasonComparisonTables(['2025-26', '2023-24'].map((season, index) => ({
			toolName: 'call_nba_stats_endpoint', request: { endpointId: 'playergamelog', params: { PlayerID: '1', Season: season } },
			response: { ok: true, data: { resultSets: [{ name: 'PlayerGameLog', headers: ['GAME_DATE', 'PTS'], rows: [[`${season.slice(0, 4)}-11-01`, 20 + index]], truncated: index === 0 }] } }
		})));
		const table = artifacts.find((artifact) => artifact.type === 'table');
		assert.equal(table?.type, 'table');
		if (table?.type !== 'table') assert.fail('Expected comparison table');
		assert.deepEqual(table.rows.map((row) => [row.season, row.PTS]), [['2025-26', 20], ['2023-24', 21]]);
		assert.ok(artifacts.some((artifact) => artifact.type === 'text_block' && /sample/.test(artifact.text)));
	});

	test('does not publish made-only rows as an all-attempt shooting percentage', () => {
		const results = [shotAggregate('2025-26', '1', 'Mid-Range', 2, 2), shotAggregate('2023-24', '1', 'Mid-Range', 3, 3)];
		for (const result of results) {
			const filters = result.request.filters as Array<Record<string, unknown>>;
			filters.push({ column: 'SHOT_MADE_FLAG', op: 'eq', value: 1 });
		}
		const artifacts = buildSeasonComparisonTables(results);
		assert.equal(artifacts.some((artifact) => artifact.type === 'bar_chart'), false);
		assert.equal(artifacts.some((artifact) => artifact.type === 'table' && artifact.columns.includes('fgPct')), false);
	});

	test('separates time-series comparison panels by metric with correct labels and values', () => {
		const results: QueryAnswerAgentToolResult[] = ['REB', 'AST'].flatMap((metric, metricIndex) => ['2025-26', '2023-24'].map((season, seasonIndex) => ({
			toolName: 'analyze_time_series', request: {
				endpointId: 'playergamelogs', params: { PlayerID: '203999', Season: season }, dateColumn: 'GAME_DATE', valueColumn: metric, lastN: 10
			}, response: { ok: true, data: {
				valueColumn: metric, points: [{ x: `${season.slice(0, 4)}-11-01`, y: metricIndex * 10 + seasonIndex + 1 }],
				earlierWindow: { average: 1 }, recentWindow: { average: 2 }, change: 1
			} }
		})));
		const artifacts = buildSeasonComparisonTables(results);
		const charts = artifacts.filter((artifact) => artifact.type === 'line_chart');
		assert.deepEqual(charts.map((chart) => chart.yLabel), ['REB', 'AST']);
		assert.deepEqual(charts.map((chart) => chart.series.map((series) => series.points[0].y)), [[1, 2], [11, 12]]);
		assert.equal(charts.every((chart) => chart.series.every((series) => /202[35]-2[46]/.test(series.name))), true);
		assert.deepEqual(artifacts.filter((artifact) => artifact.type === 'table').map((table) => table.rows.map((row) => row.metric)), [['REB', 'REB'], ['AST', 'AST']]);
	});
});

/* Test helpers */

function shotAggregate(season: string, playerId: string, zone: string, attempts: number, makes: number): QueryAnswerAgentToolResult {
	return { toolName: 'aggregate_endpoint_rows', request: {
		endpointId: 'shotchartdetail', params: { PlayerID: playerId, Season: season, ContextMeasure: 'FGA' },
		filters: [{ column: 'SHOT_ZONE_BASIC', op: 'eq', value: zone }], aggregations: [{ op: 'sum', column: 'SHOT_MADE_FLAG' }]
	}, response: { ok: true, data: { groups: [{ key: {}, rowCount: attempts, aggregates: { 'sum:SHOT_MADE_FLAG': makes } }] } } };
}

/* End test helpers */
