import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryAnswerAgentToolResult } from '$lib/contracts/answer-response';
import { createDynamicQueryAgent } from './service';
import { createQuerySessionStore } from './query-session-store';
import { findVerifiedWinLossSplit, findWinLossSplitRepair } from './win-loss-split';
import type { DynamicAgentCompletionInput, DynamicAgentModelResponse } from './types';

const question = "Compare Victor Wembanyama's blocks per game in wins versus losses in the 2025-26 regular season.";

test('repairs a rejected player blocks split once and grounds means in the matching whole-season aggregate', async () => {
	const { agent, inputs, fetched } = createAgent([semanticCall(), stop(), recovery('aggregate_endpoint_rows'), stop(), fabricatedFinal()]);
	const response = await agent.answerQuestion(question);
	assert.equal(response.status, 'ok');
	assert.match(response.answer, /4 in wins \(3 games\).*2 in losses \(3 games\)/);
	assert.doesNotMatch(response.answer, /20|10/);
	assert.deepEqual(response.warnings, []);
	assert.deepEqual(fetched.map((params) => [params.PlayerID, params.Season, params.SeasonType]), [['1641705', '2025-26', 'Regular Season']]);
	assert.equal(inputs.length, 5);
	assert.equal(repairMessageCount(inputs), 1);
	const chart = response.artifacts.find((artifact) => artifact.type === 'bar_chart');
	if (chart?.type !== 'bar_chart') assert.fail('Expected grounded split chart');
	assert.equal(chart.yLabel, 'Blocks per game');
	assert.deepEqual(chart.bars.map((bar) => [bar.label, bar.value]), [['Wins', 4], ['Losses', 2]]);
	assert.deepEqual(response.effectiveScope?.players, [{ id: '1641705', name: 'Victor Wembanyama' }]);
});

test('accepts a complete raw game-log recovery for the same scope', async () => {
	const { agent } = createAgent([semanticCall(), stop(), recovery('call_nba_stats_endpoint'), stop(), fabricatedFinal()]);
	const response = await agent.answerQuestion(question);
	assert.equal(response.status, 'ok');
	assert.match(response.answer, /4 in wins.*2 in losses/);
	const results = response.toolResults.filter((result): result is QueryAnswerAgentToolResult => result.toolName !== 'stats_query');
	const repair = findWinLossSplitRepair(question, [results[0]], '2025-26', now);
	assert.ok(repair);
	for (const [key, value] of [['PerMode', 'Per36'], ['MeasureType', 'Advanced'], ['PaceAdjust', 'Y'], ['RankMode', 'Y'], ['DateFrom', '01/01/2026']]) {
		const changed = structuredClone(results);
		const source = changed.find((result) => result.toolName === 'call_nba_stats_endpoint');
		if (!source) assert.fail('Expected raw source');
		(source.request.params as Record<string, string>)[key] = value;
		assert.equal(findVerifiedWinLossSplit(repair, changed), null, key);
	}
	assert.equal(findVerifiedWinLossSplit({ ...repair, ids: ['1'] }, results), null, 'Conflicting names and IDs must not select either population');
});

test('grounds model self-recovery with a redundant outcome filter and removes obsolete data warnings', async () => {
	const final = fabricatedFinal();
	const output = JSON.parse(final.content ?? '{}');
	output.warnings.push({ kind: 'partial_data', message: 'Only six games were returned; this may not be the full season.' });
	final.content = JSON.stringify(output);
	const { agent, inputs } = createAgent([semanticCall(), recovery('aggregate_endpoint_rows', true), stop(), final]);
	const response = await agent.answerQuestion(question);
	assert.equal(response.status, 'ok');
	assert.match(response.answer, /4 in wins.*2 in losses/);
	assert.deepEqual(response.warnings, []);
	assert.equal(repairMessageCount(inputs), 0, 'Successful self-recovery must not trigger another planning call');
	assert.equal(inputs.length, 4);
	const results = response.toolResults.filter((result): result is QueryAnswerAgentToolResult => result.toolName !== 'stats_query');
	const scope = findWinLossSplitRepair(question, results, '2025-26', now);
	assert.ok(scope);
	for (const filters of [[{ column: 'WL', op: 'eq', value: 'W' }], [{ column: 'WL', op: 'in', values: ['W'] }], [{ column: 'PTS', op: 'gte', value: 30 }]]) {
		const changed = structuredClone(results);
		const source = changed.find((result) => result.toolName === 'aggregate_endpoint_rows');
		if (!source) assert.fail('Expected aggregate source');
		source.request.filters = filters;
		assert.equal(findVerifiedWinLossSplit(scope, changed), null, 'A narrower population cannot stand for the whole-season split');
	}
	for (const incomplete of ['groupsTruncated', 'matchedRows', 'groups']) {
		const changed = structuredClone(results);
		const source = changed.find((result) => result.toolName === 'aggregate_endpoint_rows');
		if (!source || !source.response.ok) assert.fail('Expected aggregate evidence');
		const data = source.response.data as { groupsTruncated: boolean; matchedRows: number; groups: unknown[] };
		if (incomplete === 'groupsTruncated') data.groupsTruncated = true;
		if (incomplete === 'matchedRows') data.matchedRows -= 1;
		if (incomplete === 'groups') data.groups.pop();
		assert.equal(findVerifiedWinLossSplit(scope, changed), null, incomplete);
	}
});

test('normalizes the established blocks metric alias when the model self-recovers', async () => {
	const { agent, inputs } = createAgent([semanticCall({ metric: 'blocks' }), recovery('aggregate_endpoint_rows'), stop(), fabricatedFinal()]);
	const response = await agent.answerQuestion(question);
	assert.equal(response.status, 'ok');
	assert.match(response.answer, /4 in wins.*2 in losses/);
	assert.deepEqual(response.warnings, []);
	assert.equal(repairMessageCount(inputs), 0);
});

for (const humanQuestion of [question, 'Wemby average blocks in wins vs losses for 2025-26.']) {
	test(`accepts failed nickname resolution followed by a grounded canonical identity for '${humanQuestion}'`, async () => {
		const failedAlias: DynamicAgentModelResponse = { content: null, toolCalls: [{ id: crypto.randomUUID(), name: 'resolve_players', arguments: JSON.stringify({ names: ['Wemby'] }) }] };
		const { agent, inputs } = createAgent([semanticCall({ name: 'Wemby' }), failedAlias, recovery('aggregate_endpoint_rows'), stop(), fabricatedFinal()]);
		const response = await agent.answerQuestion(humanQuestion);
		assert.equal(response.status, 'ok');
		assert.match(response.answer, /4 in wins.*2 in losses/);
		assert.deepEqual(response.warnings, []);
		assert.equal(repairMessageCount(inputs), 0);
		const results = response.toolResults.filter((result): result is QueryAnswerAgentToolResult => result.toolName !== 'stats_query');
		const scope = findWinLossSplitRepair(humanQuestion, results, '2025-26', now);
		assert.ok(scope);
		const changed = structuredClone(results);
		const resolved = changed.find((result) => result.toolName === 'resolve_players' && result.response.ok && (result.response.data as { players: Array<{ inputName: string }> }).players[0].inputName === 'Victor Wembanyama');
		if (!resolved || !resolved.response.ok) assert.fail('Expected canonical player resolution');
		const match = (resolved.response.data as { players: Array<{ matches: Array<{ id: string; canonicalName: string }> }> }).players[0].matches[0];
		match.id = '201939'; match.canonicalName = 'Stephen Curry';
		const source = changed.find((result) => result.toolName === 'aggregate_endpoint_rows');
		if (!source) assert.fail('Expected aggregate source');
		(source.request.params as Record<string, string>).PlayerID = '201939';
		assert.equal(findVerifiedWinLossSplit(scope, changed), null, 'A canonical player absent from the human question must not replace the requested player');
		assert.equal(findVerifiedWinLossSplit({ ...scope, ids: ['1'] }, results), null, 'Conflicting IDs remain rejected after alias recovery');
	});
}

test('stops after one ignored split repair and suppresses invented averages and artifacts', async () => {
	const { agent, inputs, fetched } = createAgent([semanticCall(), stop(), stop(), fabricatedFinal()]);
	const response = await agent.answerQuestion(question);
	assert.equal(response.status, 'coverage_gap');
	assert.match(response.answer, /could not verify/i);
	assert.doesNotMatch(response.answer, /20|10/);
	assert.deepEqual(response.artifacts, []);
	assert.equal(response.effectiveScope, undefined);
	assert.ok(response.warnings.some((warning) => warning.code === 'win_loss_split_not_computed'));
	assert.equal(inputs.length, 4);
	assert.equal(repairMessageCount(inputs), 1);
	assert.deepEqual(fetched, []);
});

test('does not introduce a repair for unrelated metrics or an inherited date constraint', async () => {
	const { agent } = createAgent([semanticCall(), stop(), stop(), fabricatedFinal()]);
	const response = await agent.answerQuestion(question);
	const results = response.toolResults.filter((result): result is QueryAnswerAgentToolResult => result.toolName !== 'stats_query');
	assert.equal(findWinLossSplitRepair('Compare points per game in wins and losses in 2025-26.', results, '2025-26', now), null);
	assert.equal(findWinLossSplitRepair('Compare blocks and points per game in wins and losses in 2025-26.', results, '2025-26', now), null);
	const dateScoped = structuredClone(results[0]);
	const query = dateScoped.request.query as { filters: Record<string, unknown> };
	query.filters.dateFrom = '2026-01-01';
	assert.equal(findWinLossSplitRepair(question, [dateScoped], '2025-26', now), null);
});

/* Test helpers */

const now = new Date('2026-04-15T12:00:00Z');
const endpoint = { endpointId: 'playergamelogs', params: { PlayerID: '1641705', Season: '2025-26', SeasonType: 'Regular Season' } };

function createAgent(turns: DynamicAgentModelResponse[]) {
	const inputs: DynamicAgentCompletionInput[] = []; const fetched: Array<Record<string, string>> = [];
	const agent = createDynamicQueryAgent({
		model: { async complete(input) { inputs.push(structuredClone(input)); return turns.shift() ?? assert.fail('Unexpected model call'); } },
		endpointFetcher: async (request) => {
			fetched.push(request.params);
			return { endpointId: request.endpointId, payload: { resultSets: [{ name: 'PlayerGameLogs', headers: ['WL', 'BLK'], rowSet: [['W', 5], ['L', 3], ['W', 4], ['L', 2], ['W', 3], ['L', 1]] }] },
				cacheStatus: 'miss', sourceStatus: 'ok', latencyMs: 1, stale: false, isProvisional: false, parserVersion: 'test' };
		},
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: (name) => name === 'Wemby' ? [] : [{ playerId: '1641705', canonicalName: 'Victor Wembanyama', normalizedName: 'victor wembanyama', teamId: '1610612759', snapshotVersion: 'test', importedAt: now.toISOString() }] },
		teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore(), now: () => now
	});
	return { agent, inputs, fetched };
}

function semanticCall(options: { metric?: string; name?: string } = {}): DynamicAgentModelResponse {
	return { content: null, toolCalls: [{ id: crypto.randomUUID(), name: 'execute_semantic_query', arguments: JSON.stringify({ query: {
		operation: 'split', entity: 'player', subject: { names: [options.name ?? 'Victor Wembanyama'] }, metrics: [options.metric ?? 'blk'], filters: { season: 'current', seasonType: 'Regular Season', splitBy: 'win_loss' }
	} }) }] };
}

function recovery(name: 'aggregate_endpoint_rows' | 'call_nba_stats_endpoint', redundantOutcomeFilter = false): DynamicAgentModelResponse {
	return { content: null, toolCalls: [
		{ id: crypto.randomUUID(), name: 'resolve_players', arguments: JSON.stringify({ names: ['Victor Wembanyama'] }) },
		{ id: crypto.randomUUID(), name, arguments: JSON.stringify({ ...endpoint, ...(name === 'aggregate_endpoint_rows' ? { groupBy: ['WL'], aggregations: [{ op: 'count' }, { op: 'avg', column: 'BLK' }], ...(redundantOutcomeFilter ? { filters: [{ column: 'WL', op: 'in', values: ['W', 'L'] }] } : {}) } : {}) }) }
	] };
}

function stop(): DynamicAgentModelResponse { return { content: null, toolCalls: [] }; }
function fabricatedFinal(): DynamicAgentModelResponse { return { content: JSON.stringify({ answer: 'Blocks averaged 20 in wins and 10 in losses.', warnings: [{ kind: 'capability_limit', message: 'Blocks splits are unavailable.' }], artifacts: [{ type: 'bar_chart', title: 'Invented split', xLabel: 'Result', yLabel: 'Blocks', bars: [{ label: 'Wins', value: 20 }] }] }), toolCalls: [] }; }
function repairMessageCount(inputs: DynamicAgentCompletionInput[]): number {
	return Math.max(0, ...inputs.map((input) => input.messages.filter((message) => message.role === 'system' && message.content.includes('Make one bounded attempt')).length));
}

/* End test helpers */
