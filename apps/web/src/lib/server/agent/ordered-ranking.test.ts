import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
import type { StatsQueryRow } from '$lib/contracts/semantic-query';
import { createDynamicQueryAgent } from './service';
import type { AggregateEndpointRowsRequest } from './research-context';
import type { DynamicAgentModelResponse } from './types';

const HEADERS = ['PLAYER_ID', 'PLAYER_NAME', 'AST', 'GP', 'PTS'];

/* Fixture helpers */

async function runRanking(rows: unknown[][], overrides: Record<string, unknown> = {}, artifacts: QueryAnswerArtifact[] = []) {
	const request: AggregateEndpointRowsRequest = {
		endpointId: 'leaguedashplayerstats', params: { Season: '2024-25', SeasonType: 'Regular Season', PerMode: 'PerGame' },
		filters: [{ column: 'GP', op: 'gte', value: 10 }], groupBy: ['GP'], selectColumns: ['PLAYER_NAME'], rowLimit: 5,
		orderBy: { column: 'AST', direction: 'desc' }, aggregations: [{ op: 'count' }, { op: 'sum', column: 'AST' }], ...overrides
	};
	const scripted: DynamicAgentModelResponse[] = [
		{ content: null, toolCalls: [{ id: 'rank', name: 'aggregate_endpoint_rows', arguments: JSON.stringify(request) }] },
		{ content: null, toolCalls: [] },
		{ content: JSON.stringify({ answer: 'Top qualifying assists leaders.', warnings: [], artifacts }), toolCalls: [] }
	];
	let fetches = 0;
	const agent = createDynamicQueryAgent({
		model: { async complete() { return scripted.shift() ?? assert.fail('Unexpected model turn'); } },
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
		teamDirectory: { findByNameOrAlias: () => [] },
		endpointFetcher: async ({ endpointId }) => {
			fetches += 1;
			return { endpointId, payload: { resultSets: [{ name: 'LeagueDashPlayerStats', headers: HEADERS, rowSet: rows }] }, cacheStatus: 'miss', sourceStatus: 'ok', latencyMs: 1, stale: false, isProvisional: false, parserVersion: 'v1' };
		}
	});
	const response = await agent.answerQuestion('Show the top five qualifying assists leaders in 2024-25.');
	const result = response.toolResults.find((entry) => entry.toolName === 'aggregate_endpoint_rows');
	if (!result || result.toolName !== 'aggregate_endpoint_rows') assert.fail('Missing aggregate result');
	return { response, result, fetches };
}

function rankingData(data: unknown) {
	return data as { selectedRows: StatsQueryRow[]; selectedColumns: string[]; matchedRows: number; groups: Array<{ rowCount: number; aggregates: Record<string, number> }>; orderBy: { column: string; direction: string } };
}

/* End fixture helpers */

test('selects actual top five beyond the endpoint sample cap after qualification and grounds matching artifacts', async () => {
	const rows = Array.from({ length: 300 }, (_, index) => [String(index), `Player ${index}`, index % 17, 20, index]);
	for (let index = 0; index < 5; index += 1) rows[280 + index][2] = 100 - index;
	rows.push(['tiny', 'Unqualified leader', 1000, 1, 1]);
	const unrelated: QueryAnswerArtifact = { type: 'bar_chart', title: 'Points', xLabel: 'Player', yLabel: 'PTS', bars: [{ label: 'Different population', value: 42 }] };
	const table: QueryAnswerArtifact = { type: 'table', shape: 'ranking', columns: ['PLAYER_NAME', 'AST'], rows: [{ PLAYER_NAME: 'Wrong', AST: -1 }] };
	const bars: QueryAnswerArtifact = { type: 'bar_chart', title: 'Assists', xLabel: 'Player', yLabel: 'AST', bars: [{ label: 'Wrong', value: -1 }] };
	const { response, result } = await runRanking(rows, {}, [table, table, bars, bars, unrelated]);
	assert.equal(result.response.ok, true, result.response.error);
	const data = rankingData(result.response.data);
	assert.deepEqual(data.selectedRows.map((row) => row.PLAYER_NAME), ['Player 280', 'Player 281', 'Player 282', 'Player 283', 'Player 284']);
	assert.deepEqual(data.selectedColumns, ['PLAYER_NAME', 'AST']);
	assert.equal(data.matchedRows, 300);
	assert.equal(data.groups[0]?.rowCount, 300, 'Grouping still covers the whole qualified population');
	assert.equal(data.groups[0]?.aggregates['sum:AST'], rows.slice(0, 300).reduce((sum, row) => sum + Number(row[2]), 0));
	const tables = response.artifacts.filter((artifact) => artifact.type === 'table');
	assert.equal(tables.length, 1);
	assert.deepEqual(tables[0]?.rows.map((row) => row.rank), [1, 2, 3, 4, 5]);
	assert.equal(tables[0]?.source?.endpointId, 'leaguedashplayerstats');
	assert.deepEqual(tables[0]?.source?.request.orderBy, { column: 'AST', direction: 'desc' });
	const charts = response.artifacts.filter((artifact) => artifact.type === 'bar_chart');
	assert.equal(charts.length, 2);
	assert.deepEqual(charts[0]?.bars.map((bar) => bar.value), [100, 99, 98, 97, 96]);
	assert.deepEqual(charts[1], unrelated);
});

test('orders numeric strings and keeps ties in source order with nulls last in either direction', async () => {
	const rows = [['a', 'First tie', 2, 20, 1], ['b', 'Null', null, 20, 1], ['c', 'Numeric string', '10', 20, 1], ['d', 'Second tie', 2, 20, 1], ['e', 'Zero', 0, 20, 1]];
	for (const direction of ['asc', 'desc'] as const) {
		const { result } = await runRanking(rows, { rowLimit: 5, orderBy: { column: 'ast', direction } });
		assert.equal(result.response.ok, true);
		assert.deepEqual(rankingData(result.response.data).selectedRows.map((row) => row.PLAYER_NAME), direction === 'asc'
			? ['Zero', 'First tie', 'Second tie', 'Numeric string', 'Null']
			: ['Numeric string', 'First tie', 'Second tie', 'Zero', 'Null']);
	}
});

test('rejects an unknown order column and malformed order specifications', async () => {
	const rows = [['1', 'Player', 5, 20, 1]];
	const unknown = await runRanking(rows, { orderBy: { column: 'NOT_A_COLUMN', direction: 'desc' } });
	assert.equal(unknown.result.response.ok, false);
	assert.match(unknown.result.response.error ?? '', /Unknown column.*NOT_A_COLUMN/);
	for (const orderBy of [{ column: 'AST', direction: 'sideways' }, { column: '', direction: 'desc' }, { column: 'AST', direction: 'desc', unsupported: 1 }]) {
		const invalid = await runRanking(rows, { orderBy });
		assert.equal(invalid.result.response.ok, false);
		assert.equal(invalid.fetches, 0);
		assert.match(invalid.result.response.error ?? '', /orderBy requires/);
	}
});

test('bounded selection agrees with a full-population numeric sort across row limits', async () => {
	const rows = Array.from({ length: 750 }, (_, index) => [String(index), `Player ${index}`, (index * 37) % 101, index % 3 === 0 ? 1 : 20, 1]);
	for (const direction of ['asc', 'desc'] as const) {
		const expected = rows.filter((row) => Number(row[3]) >= 10).sort((left, right) => (Number(left[2]) - Number(right[2])) * (direction === 'asc' ? 1 : -1));
		for (const rowLimit of [1, 5, 25, 500]) {
			const { result } = await runRanking(rows, { rowLimit, orderBy: { column: 'AST', direction } });
			assert.equal(result.response.ok, true);
			assert.deepEqual(rankingData(result.response.data).selectedRows.map((row) => row.PLAYER_NAME), expected.slice(0, rowLimit).map((row) => row[1]));
		}
	}
});
