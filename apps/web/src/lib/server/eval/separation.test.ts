import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DYNAMIC_AGENT_EVAL_CASES } from './cases';
import { createScopedFixtureFetcher } from './fixture-scope';
import { createBudgetedEvalModel } from './model-budget';
import { evaluateLiveExecution } from './live-assertions';
import type { EvalExecution } from './types';

test('frozen-model data rejects wrong player, season, opponent and denominator mode', async () => {
	const fetcher = createScopedFixtureFetcher(DYNAMIC_AGENT_EVAL_CASES.find((c) => c.id === 'top-five-assists')!);
	const scope = { Season: '2025-26', SeasonType: 'Regular Season', PerMode: 'PerGame' };
	assert.equal((await fetcher({ endpointId: 'leaguedashplayerstats', params: scope })).sourceStatus, 'ok');
	for (const edit of ([{ Season: '2024-25' }, { PerMode: 'Totals' }, { PlayerID: '203999' }, { OpponentTeamID: '1610612738' }] as Record<string, string>[])) {
		await assert.rejects(fetcher({ endpointId: 'leaguedashplayerstats', params: { ...scope, ...edit } }), /Unrecorded fixture scope|does not support parameter/);
	}
	for (const edit of ([{ MeasureType: 'Advanced' }, { ShotClockRange: '24-22' }, { PlayerPosition: 'G' }, { SeasonSegment: 'Post All-Star' }] as Record<string, string>[])) {
		await assert.rejects(fetcher({ endpointId: 'leaguedashplayerstats', params: { ...scope, ...edit } }), /Unrecorded fixture scope/);
	}
});

test('frozen trend fixture permits the recorded ten-game window and singular endpoint alias but rejects other windows', async () => {
	const evalCase = DYNAMIC_AGENT_EVAL_CASES.find((candidate) => candidate.local.fixtureId === 'jokic_rebound_trend')!;
	const fetcher = createScopedFixtureFetcher(evalCase);
	const params = { PlayerID: '203999', Season: '2025-26', SeasonType: 'Regular Season' };
	assert.equal((await fetcher({ endpointId: 'playergamelogs', params: { ...params, LastNGames: '10' } })).sourceStatus, 'ok');
	assert.equal((await fetcher({ endpointId: 'playergamelogs', params: { ...params, LastNGames: '10', PerMode: 'PerGame' } })).sourceStatus, 'ok');
	const alias = await fetcher({ endpointId: 'playergamelog', params });
	assert.equal((alias.payload as { resultSets: Array<{ name: string }> }).resultSets[0].name, 'PlayerGameLog');
	await assert.rejects(fetcher({ endpointId: 'playergamelogs', params: { ...params, LastNGames: '5' } }), /Unrecorded fixture scope/);
});

test('recorded per-game log fixtures accept Totals/PerGame equivalence without widening other filters', async () => {
	for (const [fixtureId, playerId] of [['sga_scoring_record', '1628983'], ['wemby_blocks_split', '1641705'], ['jokic_rebound_trend', '203999']]) {
		const candidate = DYNAMIC_AGENT_EVAL_CASES.find((item) => item.local.fixtureId === fixtureId)!;
		const fetcher = createScopedFixtureFetcher(candidate);
		const params = { PlayerID: playerId, Season: '2025-26', SeasonType: 'Regular Season' };
		for (const PerMode of ['Totals', 'PerGame']) assert.equal((await fetcher({ endpointId: 'playergamelogs', params: { ...params, PerMode } })).sourceStatus, 'ok');
		for (const edit of ([{ LastNGames: '5' }, { PerMode: 'Per36' }, { Outcome: 'W' }, { DateFrom: '2026-03-01' }, { Season: '2024-25' }] as Record<string, string>[])) {
			await assert.rejects(fetcher({ endpointId: 'playergamelogs', params: { ...params, PerMode: 'Totals', ...edit } }), /Unrecorded fixture scope/);
		}
	}
});

test('frozen ranking permits an equivalent recorded leader endpoint while rejecting changed ranking scope', async () => {
	const fetcher = createScopedFixtureFetcher(DYNAMIC_AGENT_EVAL_CASES.find((candidate) => candidate.id === 'top-five-assists')!);
	const params = { Season: '2025-26', SeasonType: 'Regular Season', PerMode: 'PerGame', StatCategory: 'AST' };
	const result = await fetcher({ endpointId: 'leagueleaders', params });
	assert.equal((result.payload as { resultSets: Array<{ name: string }> }).resultSets[0].name, 'LeagueLeaders');
	await assert.rejects(fetcher({ endpointId: 'leagueleaders', params: { ...params, StatCategory: 'PTS' } }), /Unrecorded fixture scope/);
});

test('unavailable scoring fixture preserves upstream failure for the equivalent leader endpoint and rejects changed populations', async () => {
	const candidate = DYNAMIC_AGENT_EVAL_CASES.find((item) => item.id === 'endpoint-failure-product-hygiene')!;
	const fetcher = createScopedFixtureFetcher(candidate);
	const params = { Season: '2025-26', SeasonType: 'Regular Season', PerMode: 'PerGame', StatCategory: 'PTS' };
	const result = await fetcher({ endpointId: 'leagueleaders', params });
	assert.equal(result.endpointId, 'leagueleaders');
	assert.equal(result.sourceStatus, 'error');
	assert.equal(result.payload, null);
	assert.match(result.errorDetail ?? '', /HTTP 500/);
	for (const edit of ([{ Season: '2024-25' }, { SeasonType: 'Playoffs' }, { PerMode: 'Totals' }, { StatCategory: 'AST' }, { Scope: 'RS' }, { LeagueID: '10' }, { ActiveFlag: 'Y' }, { LastNGames: '5' }] as Record<string, string>[])) {
		await assert.rejects(fetcher({ endpointId: 'leagueleaders', params: { ...params, ...edit } }), /Unrecorded fixture scope|does not support parameter/);
	}
});

test('frozen defender fixture permits the recorded full matchup population and rejects offensive-player narrowing', async () => {
	const fetcher = createScopedFixtureFetcher(DYNAMIC_AGENT_EVAL_CASES.find((candidate) => candidate.id === 'scottie-defender-lowest-fg-pct')!);
	const params = { Season: '2025-26', SeasonType: 'Regular Season', DefPlayerID: '1630567', OffPlayerID: '', PerMode: 'Totals' };
	assert.equal((await fetcher({ endpointId: 'leagueseasonmatchups', params })).sourceStatus, 'ok');
	await assert.rejects(fetcher({ endpointId: 'leagueseasonmatchups', params: { ...params, OffPlayerID: '1628369' } }), /Unrecorded fixture scope/);
});

test('budget refuses the next call before sending a request and accounts for successful usage', async () => {
	let calls = 0;
	const usage = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
	const budget = { remainingUsd: 0.000001, inputRate: 0.1, outputRate: 0.5 };
	const model = createBudgetedEvalModel({ async complete() { calls++; return { content: 'ok', toolCalls: [], usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } }; } }, budget, usage);
	await assert.rejects(model.complete({ messages: [] }), /budget exhausted/);
	assert.equal(calls, 0);
	budget.remainingUsd = 0.1;
	await model.complete({ messages: [] });
	assert.equal(calls, 1);
	assert.equal(usage.totalTokens, 110);
	assert.ok(budget.remainingUsd < 0.1);
});

test('budget retries token-rate refusals within one reservation and never retries quota failures', async () => {
	let calls = 0;
	const usage = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
	const budget = { remainingUsd: 0.1, inputRate: 0.1, outputRate: 0.5 };
	const rateError = Object.assign(new Error('Rate refused'), { status: 429, code: 'rate_limit_exceeded', headers: new Headers({ 'retry-after': '0.001' }) });
	const model = createBudgetedEvalModel({ async complete() {
		calls++;
		if (calls < 3) throw rateError;
		return { content: 'ok', toolCalls: [], usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } };
	} }, budget, usage);
	await model.complete({ messages: [] });
	assert.equal(calls, 3);
	assert.equal(usage.calls, 1);
	assert.ok(budget.remainingUsd > 0.099);

	let quotaCalls = 0;
	const quotaModel = createBudgetedEvalModel({ async complete() {
		quotaCalls++;
		throw Object.assign(new Error('Quota unavailable'), { status: 429, code: 'insufficient_quota' });
	} }, budget, usage);
	await assert.rejects(quotaModel.complete({ messages: [] }), /Quota unavailable/);
	assert.equal(quotaCalls, 1);
});

test('live grounding accepts different NBA numbers but still rejects chart population mismatch', () => {
	const c = DYNAMIC_AGENT_EVAL_CASES.find((c) => c.id === 'scottie-pullup-midrange-fg-pct')!;
	const execution: EvalExecution = {
		response: { status: 'ok', answer: 'Made 1 of 2.', artifacts: [{ type:'shot_chart',title:'Shots',shots:[{locX:0,locY:0,made:true},{locX:1,locY:1,made:false}]}], toolResults:[{toolName:'aggregate_endpoint_rows',request:{},response:{ok:true,data:{matchedRows:2,groups:[{aggregates:{'sum:SHOT_MADE_FLAG':1}}]}}}],citations:[],warnings:[],traceId:'test'},
		trace: { toolCalls:[],latencyMs:{total:1},warnings:[] }, endpointCalls:[]
	};
	assert.deepEqual(evaluateLiveExecution(c,execution), []);
	if (execution.response.artifacts[0].type === 'shot_chart') execution.response.artifacts[0].shots.pop();
	assert.ok(evaluateLiveExecution(c,execution).some((x)=>x.includes('chart attempts')));
});

// --- Ranking fixture helpers ---

function rankingExecution(): EvalExecution {
	const rows = Array.from({ length: 7 }, (_, index) => [`Player ${index + 1}`, 20 - index]);
	return {
		response: {
			status: 'ok', answer: 'The top five assists-per-game leaders.',
			artifacts: [{ type: 'bar_chart', title: 'Leaders', xLabel: 'Player', yLabel: 'APG', bars: rows.slice(0, 5).map(([label, value]) => ({ label: String(label), value: Number(value) })) }],
			toolResults: [{ toolName: 'call_nba_stats_endpoint', request: { endpointId: 'leaguedashplayerstats', params: { Season: '2025-26', SeasonType: 'Regular Season', PerMode: 'PerGame' } }, response: { ok: true, data: { resultSets: [{ headers: ['PLAYER', 'AST'], rows }] } } }],
			citations: [], warnings: [], traceId: 'ranking-test'
		},
		trace: { toolCalls: [], latencyMs: { total: 1 }, warnings: [] }, endpointCalls: []
	};
}

// --- End ranking fixture helpers ---

test('live ranking rejects empty, fabricated, duplicate and lower-ranked bars despite valid-looking output', () => {
	const evalCase = DYNAMIC_AGENT_EVAL_CASES.find((candidate) => candidate.id === 'top-five-assists')!;
	assert.deepEqual(evaluateLiveExecution(evalCase, rankingExecution()), []);
	for (const mutate of [
		(execution: EvalExecution) => { if (execution.response.artifacts[0].type === 'bar_chart') execution.response.artifacts[0].bars = []; },
		(execution: EvalExecution) => { if (execution.response.artifacts[0].type === 'bar_chart') execution.response.artifacts[0].bars[0].value = 999; },
		(execution: EvalExecution) => { if (execution.response.artifacts[0].type === 'bar_chart') execution.response.artifacts[0].bars[1] = execution.response.artifacts[0].bars[0]; },
		(execution: EvalExecution) => { if (execution.response.artifacts[0].type === 'bar_chart') execution.response.artifacts[0].bars = Array.from({ length: 5 }, (_, index) => ({ label: `Player ${index + 3}`, value: 18 - index })); }
	]) {
		const execution = rankingExecution();
		mutate(execution);
		assert.ok(evaluateLiveExecution(evalCase, execution).some((failure) => failure.includes('ranking_grounding')));
	}
});

test('live ranking requires the season, denominator and full population requested by the user', () => {
	const evalCase = DYNAMIC_AGENT_EVAL_CASES.find((candidate) => candidate.id === 'top-five-assists')!;
	for (const edit of [{ Season: '2024-25' }, { PerMode: 'Totals' }, { LastNGames: '5' }, { OpponentTeamID: '1610612738' }]) {
		const execution = rankingExecution();
		const request = execution.response.toolResults[0].request as Record<string, unknown>;
		request.params = { ...(request.params as Record<string, string>), ...edit };
		assert.ok(evaluateLiveExecution(evalCase, execution).some((failure) => failure.includes('no successful ranking population')));
	}
});

test('live ranking accepts a semantic ranking path and resolves boundary ties without inventing values', () => {
	const evalCase = DYNAMIC_AGENT_EVAL_CASES.find((candidate) => candidate.id === 'top-five-assists')!;
	const execution = rankingExecution();
	execution.response.toolResults = [{
		toolName: 'execute_semantic_query', request: { query: { operation: 'rank', entity: 'player', subject: {}, metrics: ['ast'], filters: { season: '2025-26', seasonType: 'Regular Season' }, orderBy: { metric: 'ast', direction: 'desc' }, limit: 5 } },
		response: { ok: true, data: { result: { rows: Array.from({ length: 7 }, (_, index) => ({ subject: `Player ${index + 1}`, metric: 'ast', value: index < 4 ? 20 - index : 16 })) } } }
	}];
	if (execution.response.artifacts[0].type === 'bar_chart') execution.response.artifacts[0].bars[4] = { label: 'Player 7', value: 16 };
	assert.deepEqual(evaluateLiveExecution(evalCase, execution), []);
});
