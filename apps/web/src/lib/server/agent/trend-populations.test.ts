import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryAnswerAgentToolResult, QueryAnswerArtifact } from '$lib/contracts/answer-response';
import { buildVerifiedTrendPopulationAnswer, collectVerifiedTrendPopulations, countUnverifiedTrendScopes, reconcileVerifiedTrendArtifacts } from './trend-populations';

test('preserves two players and two metrics as independently grounded series and comparison rows', () => {
	const results = [trend('203999', 'REB', [20, 18, 10, 8]), trend('203954', 'REB', [8, 10, 14, 16]), trend('203999', 'AST', [2, 4, 8, 10]), trend('203954', 'AST', [12, 10, 6, 4])];
	const populations = collectVerifiedTrendPopulations(results);
	const artifacts = reconcileVerifiedTrendArtifacts(inventedArtifacts, populations);
	const charts = artifacts.filter((artifact) => artifact.type === 'line_chart');
	assert.equal(charts.length, 2);
	assert.deepEqual(charts.map((chart) => chart.yLabel), ['Rebounds', 'Assists']);
	assert.deepEqual(charts[0].series.map((series) => series.points.map((point) => point.y)), [[20, 18, 10, 8], [8, 10, 14, 16]]);
	assert.match(charts[0].series[0].name, /Nikola Jokic/);
	assert.match(charts[0].series[1].name, /Joel Embiid/);
	assert.equal(artifacts.find((artifact) => artifact.type === 'table')?.rows.length, 4);
	const answer = buildVerifiedTrendPopulationAnswer(populations);
	assert.match(answer, /Nikola Jokic.*Rebounds trended down.*19.*9/);
	assert.match(answer, /Joel Embiid.*Rebounds trended up.*9.*15/);
	assert.match(answer, /Assists trended up.*3.*9/);
	assert.doesNotMatch(answer, /999/);
});

test('seasons and different date windows stay distinct while exact computation retries deduplicate', () => {
	const first = trend('203999', 'REB', [1, 2, 3, 4]);
	const second = trend('203999', 'REB', [5, 6, 7, 8], { Season: '2024-25' });
	const third = trend('203999', 'REB', [9, 10, 11, 12], { DateFrom: '01/01/2026', DateTo: '01/31/2026' });
	const artifacts = reconcileVerifiedTrendArtifacts([], collectVerifiedTrendPopulations([first, second, third, first]));
	const chart = artifacts.find((artifact) => artifact.type === 'line_chart');
	assert.equal(chart?.series.length, 3);
	assert.match(chart!.series[1].name, /2024-25/);
	assert.match(chart!.series[2].name, /from 01\/01\/2026.*through 01\/31\/2026/);
});

test('reports failed populations without discarding a successful distinct trend; exact successful retry clears it', () => {
	const success = trend('203999', 'REB', [1, 2, 3, 4]);
	const failed = { ...trend('203954', 'AST', [4, 3, 2, 1]), response: { ok: false, error: 'Unavailable' } };
	assert.equal(countUnverifiedTrendScopes([success, failed]), 1);
	assert.equal(collectVerifiedTrendPopulations([success, failed]).length, 1);
	assert.equal(countUnverifiedTrendScopes([success, failed, trend('203954', 'AST', [4, 3, 2, 1])]), 0);
});

test('a corrected upstream player-game retrieval replaces the eight-game sample with the complete ten-game window', () => {
	const params = { Season: '2024-25', MeasureType: 'Base', PerMode: 'PerGame' };
	const short = trend('203999', 'REB', [8, 9, 10, 11, 12, 13, 14, 15], { ...params, LastNGames: '10' });
	const complete = trend('203999', 'REB', [20, 21, 22, 23, 24, 25, 26, 27, 28, 29], { ...params, LastNGames: '0' });
	short.request.lastN = 10;
	complete.request.lastN = 10;
	for (const results of [[short, complete], [complete, short]]) {
		const populations = collectVerifiedTrendPopulations(results);
		assert.equal(populations.length, 1);
		assert.deepEqual(populations[0].points.map((point) => point.y), [20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
		assert.equal(populations[0].earlierWindow.average, 22);
		assert.equal(populations[0].recentWindow.average, 27);
		assert.doesNotMatch(populations[0].scopeLabel, /LastNGames/);
		assert.equal(countUnverifiedTrendScopes(results), 0);
		const chart = reconcileVerifiedTrendArtifacts([], populations).find((artifact) => artifact.type === 'line_chart');
		assert.equal(chart?.series.length, 1);
	}
});

test('an upstream-window failure is superseded by the same scoped computation using full player logs', () => {
	const failed = trend('1641705', 'BLK', [], { LastNGames: '10' });
	failed.request.lastN = 10;
	failed.response = { ok: false, error: 'No player games in the upstream team window' };
	const repaired = trend('1641705', 'BLK', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { LastNGames: '0' });
	repaired.request.lastN = 10;
	assert.equal(countUnverifiedTrendScopes([failed, repaired]), 0);
	assert.equal(collectVerifiedTrendPopulations([failed, repaired]).length, 1);
	const changedDate = { ...repaired, request: { ...repaired.request, params: { ...(repaired.request.params as Record<string, string>), DateFrom: '2025-01-01' } } };
	assert.equal(countUnverifiedTrendScopes([failed, changedDate]), 1, 'Another date population cannot repair this scope');
});

test('computed game count and genuine filters remain separate population dimensions', () => {
	const first = trend('203999', 'REB', [1, 2, 3, 4], { LastNGames: '10' });
	const shorter = trend('203999', 'REB', [5, 6], { LastNGames: '0' });
	shorter.request.lastN = 2;
	const period = trend('203999', 'REB', [7, 8, 9, 10], { LastNGames: '0', Period: '4' });
	assert.equal(collectVerifiedTrendPopulations([first, shorter, period]).length, 3);
});

test('rejects league-wide logs, invalid numeric points and reverse chronology', () => {
	const unscoped = trend('0', 'REB', [1, 2]);
	const invalid = trend('203999', 'REB', [1, Number.NaN]);
	const reversed = trend('203999', 'REB', [1, 2]);
	const data = reversed.response.data as { points: Array<{ x: string; y: number }> };
	data.points.reverse();
	assert.deepEqual(collectVerifiedTrendPopulations([unscoped, invalid, reversed]), []);
	assert.equal(countUnverifiedTrendScopes([unscoped, invalid, reversed]), 2);
});

test('rejects a returned population that contradicts the requested player identity', () => {
	const result = trend('203999', 'REB', [1, 2]);
	const data = result.response.data as { points: Array<{ x: string; y: number; labels?: unknown }> };
	data.points[0].labels = { PLAYER_ID: '203954' };
	assert.deepEqual(collectVerifiedTrendPopulations([result]), []);
});

/* Test helpers */

const inventedArtifacts: QueryAnswerArtifact[] = [{ type: 'line_chart', title: 'Mixed invented values', xLabel: 'Game', yLabel: 'Value', series: [{ name: 'Invented', points: [{ x: 'bad', y: 999 }] }] }, { type: 'table', shape: 'comparison', columns: ['earlierAverage'], rows: [{ earlierAverage: 999 }] }, { type: 'text_block', text: 'Invented average 999.' }];

function trend(playerId: string, metric: string, values: number[], params: Record<string, string> = {}): QueryAnswerAgentToolResult {
	return { toolName: 'analyze_time_series', request: { endpointId: 'playergamelogs', params: { PlayerID: playerId, Season: '2025-26', SeasonType: 'Regular Season', ...params }, resultSetName: 'PlayerGameLogs', dateColumn: 'GAME_DATE', valueColumn: metric, lastN: 4 }, response: { ok: true, data: { valueColumn: metric, points: values.map((y, index) => ({ x: `2026-04-${String(index + 1).padStart(2, '0')}`, y })) } } };
}

/* End test helpers */
