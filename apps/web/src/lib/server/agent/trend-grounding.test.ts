import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDynamicQueryAgent } from './service';
import { createQuerySessionStore } from './query-session-store';
import type { DynamicAgentCompletionInput, DynamicAgentModelResponse } from './types';

test('repairs raw-log-only trend planning and grounds final prose in the chronological computation', async () => {
	const turns = [call('call_nba_stats_endpoint', endpoint), stop(), call('analyze_time_series', {
		...endpoint, resultSetName: 'PlayerGameLogs', dateColumn: 'GAME_DATE', valueColumn: 'REB', lastN: 10
	}), stop(), fabricatedFinal()];
	const { agent, inputs } = createAgent(turns);
	const response = await agent.answerQuestion('Is Joker rebounding up or down over his latest ten games in 2025-26?');
	assert.equal(response.status, 'ok');
	assert.match(response.answer, /16\.4/);
	assert.match(response.answer, /12\.6/);
	assert.match(response.answer, /trended down/);
	assert.doesNotMatch(response.answer, /16\.0|12\.8/);
	assert.equal(inputs.length, 5);
	assert.ok(inputs.some((input) => input.messages.some((message) => typeof message.content === 'string' && message.content.includes('no verified chronological comparison'))));
	const chart = response.artifacts.find((artifact) => artifact.type === 'line_chart');
	if (chart?.type !== 'line_chart') assert.fail('Expected verified trend chart');
	assert.deepEqual(chart.series[0].points.map((point) => point.y), [...rebounds].reverse());
});

test('suppresses invented trend prose and charts if the model refuses the computation repair', async () => {
	const { agent, inputs } = createAgent([call('call_nba_stats_endpoint', endpoint), stop(), stop(), fabricatedFinal()]);
	const response = await agent.answerQuestion('Are rebounds trending up or down in 2025-26?');
	assert.equal(response.status, 'coverage_gap');
	assert.match(response.answer, /could not verify/i);
	assert.doesNotMatch(response.answer, /16\.0|12\.8/);
	assert.deepEqual(response.artifacts, []);
	assert.ok(response.warnings.some((warning) => warning.code === 'trend_not_computed'));
	assert.equal(inputs.length, 4, 'Only one planning repair is allowed');
});

for (const question of [
	'Show Jokic’s rebounds in his final ten games of the 2025-26 regular season. Compare the earlier five with the later five and show a chart.',
	'Compare rebounds in the last 5 games with the previous 5 games in 2025-26.'
]) {
	test(`grounds an explicit chronological window comparison: ${question}`, async () => {
		const { agent } = createAgent([call('call_nba_stats_endpoint', endpoint), stop(), call('analyze_time_series', {
			...endpoint, resultSetName: 'PlayerGameLogs', dateColumn: 'GAME_DATE', valueColumn: 'REB', lastN: 10
		}), stop(), fabricatedFinal()]);
		const response = await agent.answerQuestion(question);
		assert.equal(response.status, 'ok');
		assert.match(response.answer, /16\.4.*12\.6/);
		assert.doesNotMatch(response.answer, /16\.0|12\.8/);
		assert.ok(response.artifacts.some((artifact) => artifact.type === 'line_chart'));
	});
}

for (const variant of ['player', 'metric'] as const) {
	test(`declines multiple ${variant} trend populations without relabelling the latest result`, async () => {
		const first = { ...endpoint, resultSetName: 'PlayerGameLogs', dateColumn: 'GAME_DATE', valueColumn: 'REB', lastN: 10 };
		const second = variant === 'player' ? { ...first, params: { ...endpoint.params, PlayerID: '1630173' } } : { ...first, valueColumn: 'AST' };
		const { agent } = createAgent([call('analyze_time_series', first), call('analyze_time_series', second), stop(), fabricatedFinal()]);
		const response = await agent.answerQuestion('Compare these trends in 2025-26.');
		assert.equal(response.status, 'coverage_gap');
		assert.match(response.answer, /one player or team and one metric/i);
		assert.doesNotMatch(response.answer, /16\.0|12\.8|trended down/);
		assert.deepEqual(response.artifacts, []);
		assert.equal(response.effectiveScope, undefined);
		assert.ok(response.warnings.some((warning) => warning.code === 'trend_scope_unsupported'));
	});
}

test('allows repeated computation of the same trend scope', async () => {
	const request = { ...endpoint, resultSetName: 'PlayerGameLogs', dateColumn: 'GAME_DATE', valueColumn: 'REB', lastN: 10 };
	const { agent } = createAgent([call('analyze_time_series', request), call('analyze_time_series', request), stop(), fabricatedFinal()]);
	const response = await agent.answerQuestion('Are rebounds trending down in 2025-26?');
	assert.equal(response.status, 'ok');
	assert.match(response.answer, /16\.4.*12\.6/);
	assert.ok(response.artifacts.some((artifact) => artifact.type === 'line_chart'));
});

/* Test helpers */

const endpoint = { endpointId: 'playergamelogs', params: { PlayerID: '203999', Season: '2025-26', SeasonType: 'Regular Season' } };
const rebounds = [8, 16, 14, 8, 17, 15, 15, 21, 17, 14];

function createAgent(turns: DynamicAgentModelResponse[]) {
	const inputs: DynamicAgentCompletionInput[] = [];
	const agent = createDynamicQueryAgent({
		model: { async complete(input) { inputs.push(structuredClone(input)); return turns.shift() ?? assert.fail('Unexpected model call'); } },
		endpointFetcher: async () => ({ endpointId: 'playergamelogs',
			payload: { resultSets: [{ name: 'PlayerGameLogs', headers: ['GAME_DATE', 'REB', 'AST'], rowSet: rebounds.map((value, index) => [`2026-04-${String(15 - index).padStart(2, '0')}`, value, 2 + index]) }] },
			cacheStatus: 'miss', sourceStatus: 'ok', latencyMs: 1, stale: false, isProvisional: false, parserVersion: 'test' }),
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
		teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore(), now: () => new Date('2026-04-15T12:00:00Z')
	});
	return { agent, inputs };
}

function call(name: string, args: unknown): DynamicAgentModelResponse {
	return { content: null, toolCalls: [{ id: crypto.randomUUID(), name, arguments: JSON.stringify(args) }] };
}

function stop(): DynamicAgentModelResponse { return { content: null, toolCalls: [] }; }

function fabricatedFinal(): DynamicAgentModelResponse {
	return { content: JSON.stringify({ answer: 'Rebounds went down from 16.0 to 12.8.', warnings: [], artifacts: [{ type: 'line_chart', title: 'Rebound trend', xLabel: 'Game', yLabel: 'Rebounds', series: [{ name: 'Rebounds', points: [{ x: 'invented', y: 999 }] }] }] }), toolCalls: [] };
}

/* End test helpers */
