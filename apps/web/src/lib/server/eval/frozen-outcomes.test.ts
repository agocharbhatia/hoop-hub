import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DYNAMIC_AGENT_EVAL_CASES } from './cases';
import { evaluateFrozenExecution } from './frozen-assertions';
import type { EvalCase, EvalExecution } from './types';
import { createEvalFixtureFetcher } from './fixtures';

// --- Outcome fixture helpers ---

function evalCase(id: string): EvalCase {
	const candidate = DYNAMIC_AGENT_EVAL_CASES.find((item) => item.id === id);
	assert.ok(candidate);
	return candidate;
}

function executionFor(candidate: EvalCase): EvalExecution {
	return {
		response: { status: candidate.expectedStatus, answer: candidate.local.finalOutput.answer, artifacts: structuredClone(candidate.local.finalOutput.artifacts), toolResults: [], citations: [], warnings: [], traceId: 'frozen-outcome' },
		trace: { toolCalls: [], latencyMs: { total: 1 }, warnings: [] }, endpointCalls: []
	};
}

function rankedSelection() {
	const candidate = evalCase('top-five-assists');
	const execution = executionFor(candidate);
	const chart = execution.response.artifacts[0];
	assert.equal(chart.type, 'bar_chart');
	if (chart.type !== 'bar_chart') throw new Error('Missing chart fixture.');
	execution.response.toolResults = [{
		toolName: 'aggregate_endpoint_rows',
		request: { endpointId: 'leagueleaders', params: { Season: '2025-26', SeasonType: 'Regular Season', PerMode: 'PerGame', StatCategory: 'AST' }, orderBy: { column: 'AST', direction: 'desc' }, selectColumns: ['PLAYER', 'AST'], rowLimit: 5, filters: [], groupBy: [] },
		response: { ok: true, data: { totalRows: 170, matchedRows: 170, orderBy: { column: 'AST', direction: 'desc' }, selectedRows: chart.bars.map((bar) => ({ PLAYER: bar.label, AST: bar.value })), selectedRowsTruncated: true } }
	}];
	return { candidate, execution };
}

function blockSplit(useSum: boolean) {
	const candidate = evalCase('wemby-blocks-wins-vs-losses');
	const execution = executionFor(candidate);
	execution.response.answer = 'Wembanyama averaged 4.0 blocks per game in wins (16 blocks in 4 games) and 2.0 in losses (4 blocks in 2 games).';
	execution.response.toolResults = [{ toolName: 'aggregate_endpoint_rows', request: {}, response: { ok: true, data: {
		totalRows: 6, matchedRows: 6, groupsTruncated: false,
		groups: [{ key: { WL: 'L' }, rowCount: 2, aggregates: useSum ? { 'sum:BLK': 4, 'count:*': 2 } : { 'avg:BLK': 2 } }, { key: { WL: 'W' }, rowCount: 4, aggregates: useSum ? { 'sum:BLK': 16, 'count:*': 4 } : { 'avg:BLK': 4 } }]
	} } }];
	return { candidate, execution };
}

async function sgaRawRecord() {
	const candidate = evalCase('sga-30-point-record');
	const execution = executionFor(candidate);
	const params = { PlayerID: '1628983', Season: '2025-26', SeasonType: 'Regular Season' };
	const fixture = await createEvalFixtureFetcher('sga_scoring_record')({ endpointId: 'playergamelogs', params });
	const source = (fixture.payload as { resultSets: Array<{ headers: string[]; rowSet: unknown[][] }> }).resultSets[0];
	execution.response.toolResults = [{ toolName: 'call_nba_stats_endpoint', request: { endpointId: 'playergamelog', params }, response: { ok: true, data: { resultSets: [{ headers: source.headers, rows: source.rowSet, totalRows: source.rowSet.length, truncated: false }] } } }];
	return { candidate, execution };
}

// --- End outcome fixture helpers ---

test('frozen ranking accepts complete aggregate ordering but rejects subsets, wrong order and changed gold values', () => {
	const correct = rankedSelection();
	assert.deepEqual(evaluateFrozenExecution(correct.candidate, correct.execution), []);
	for (const mutate of [
		(data: Record<string, unknown>, request: Record<string, unknown>) => { data.matchedRows = 5; },
		(data: Record<string, unknown>, request: Record<string, unknown>) => { request.orderBy = { column: 'AST', direction: 'asc' }; },
		(data: Record<string, unknown>, request: Record<string, unknown>) => { request.filters = [{ column: 'TEAM', op: 'eq', value: 'DEN' }]; },
		(data: Record<string, unknown>, request: Record<string, unknown>) => { request.rowLimit = 3; }
	]) {
		const { candidate, execution } = rankedSelection();
		const result = execution.response.toolResults[0];
		assert.ok('data' in result.response);
		mutate(result.response.data as Record<string, unknown>, result.request as Record<string, unknown>);
		assert.ok(evaluateFrozenExecution(candidate, execution).some((failure) => failure.includes('ranking_grounding')));
	}
	const changed = rankedSelection();
	if (changed.execution.response.artifacts[0].type === 'bar_chart') changed.execution.response.artifacts[0].bars[0].value = 12;
	assert.ok(evaluateFrozenExecution(changed.candidate, changed.execution).some((failure) => failure.includes('frozen_rank_oracle')));
});

test('requested split tables satisfy numeric output without repeating every cell in prose', () => {
	const candidate = evalCase('semantic-player-win-loss-split');
	const execution = executionFor(candidate);
	const response = candidate.local.semanticResponses![0];
	execution.response.answer = 'Nikola Jokic’s averages, split by game result:';
	execution.response.artifacts = [{ type: 'table', shape: 'table', columns: [...response.result!.columns], rows: structuredClone(response.result!.rows).reverse() }];
	execution.trace.toolCalls = [{ toolCallId: 'split', toolName: 'execute_semantic_query', request: { query: response.provenance.resolvedQuery }, ok: true, latencyMs: 1 }];
	assert.deepEqual(evaluateFrozenExecution(candidate, execution), []);
	const hidden = structuredClone(execution);
	if (hidden.response.artifacts[0].type === 'table') hidden.response.artifacts[0].columns = ['split', 'games'];
	assert.ok(evaluateFrozenExecution(candidate, hidden).some((failure) => failure.includes('frozen_split_oracle')));
	if (execution.response.artifacts[0].type === 'table') execution.response.artifacts[0].rows[0].reb = 999;
	assert.ok(evaluateFrozenExecution(candidate, execution).some((failure) => failure.includes('frozen_split_oracle')));
});

test('Wemby split accepts averages or independent sum/count computation and rejects wrong denominators or display claims', () => {
	for (const useSum of [false, true]) {
		const { candidate, execution } = blockSplit(useSum);
		assert.deepEqual(evaluateFrozenExecution(candidate, execution), []);
	}
	const wrongCount = blockSplit(true);
	const result = wrongCount.execution.response.toolResults[0];
	assert.ok('data' in result.response);
	(result.response.data as { groups: Array<{ rowCount: number }> }).groups[0].rowCount = 4;
	assert.ok(evaluateFrozenExecution(wrongCount.candidate, wrongCount.execution).some((failure) => failure.includes('frozen_blocks_oracle')));
	const wrongDisplay = blockSplit(true);
	wrongDisplay.execution.response.answer = 'Wembanyama averaged 2 blocks in wins and 4 blocks in losses.';
	assert.ok(evaluateFrozenExecution(wrongDisplay.candidate, wrongDisplay.execution).some((failure) => failure.includes('frozen_blocks_display')));
	const table = blockSplit(true);
	table.execution.response.answer = 'The blocks-per-game split is shown below.';
	table.execution.response.artifacts = [{ type: 'table', shape: 'comparison', columns: ['WL', 'blocksPerGame'], rows: [{ WL: 'W', blocksPerGame: 4 }, { WL: 'L', blocksPerGame: 2 }] }];
	assert.deepEqual(evaluateFrozenExecution(table.candidate, table.execution), []);
});

test('honest unavailable-data outcome accepts canonical warning alternatives while retaining warning and hygiene guards', () => {
	const candidate = evalCase('endpoint-failure-product-hygiene');
	for (const code of ['data_unavailable', 'dynamic_agent_partial_data']) {
		for (const answer of ['I cannot verify the leader.', 'I can’t verify the leader.', "I couldn't retrieve the leader."] ) {
			const execution = executionFor(candidate);
			execution.response.answer = answer;
			execution.response.warnings = [{ code, message: 'The requested data was unavailable.' }];
			assert.deepEqual(evaluateFrozenExecution(candidate, execution), []);
			for (const diagnostic of [' transport=direct; timeout_ms=15000', ' HTTP 500']) {
				const exposed = structuredClone(execution);
				exposed.response.answer += diagnostic;
				assert.ok(evaluateFrozenExecution(candidate, exposed).some((failure) => failure.includes('response_hygiene')));
			}
		}
	}
	for (const warnings of [[], [{ code: 'dynamic_agent_capability_limit', message: 'The requested data was unavailable.' }]]) {
		const missing = executionFor(candidate);
		missing.response.warnings = warnings;
		assert.ok(evaluateFrozenExecution(candidate, missing).some((failure) => failure.includes('required_warning')));
	}
	const fabricated = executionFor(candidate);
	fabricated.response.warnings = [{ code: 'data_unavailable', message: 'The requested data was unavailable.' }];
	fabricated.response.artifacts = [{ type: 'table', shape: 'table', columns: ['leader'], rows: [{ leader: 'Unverified player' }] }];
	assert.ok(evaluateFrozenExecution(candidate, fabricated).some((failure) => failure.includes('frozen_unavailable_oracle')));
	fabricated.response.artifacts = [];
	fabricated.response.answer = 'Player One leads the NBA in scoring.';
	assert.ok(evaluateFrozenExecution(candidate, fabricated).some((failure) => failure.includes('answer_grounding')));
});

test('SGA record accepts independently counted complete raw game rows and rejects altered thresholds, counts or scope', async () => {
	const { candidate, execution } = await sgaRawRecord();
	assert.deepEqual(evaluateFrozenExecution(candidate, execution), []);
	for (const mutate of [
		(data: Record<string, unknown>) => { const sets = data.resultSets as Array<{ truncated: boolean }>; sets[0].truncated = true; },
		(data: Record<string, unknown>) => { const sets = data.resultSets as Array<{ rows: unknown[][]; headers: string[] }>; sets[0].rows[0][sets[0].headers.indexOf('PTS')] = 29; },
		(data: Record<string, unknown>) => { const sets = data.resultSets as Array<{ rows: unknown[][]; headers: string[] }>; sets[0].rows[0][sets[0].headers.indexOf('WL')] = 'L'; }
	]) {
		const altered = await sgaRawRecord();
		const result = altered.execution.response.toolResults[0];
		assert.ok('data' in result.response);
		mutate(result.response.data as Record<string, unknown>);
		assert.ok(evaluateFrozenExecution(altered.candidate, altered.execution).some((failure) => failure.includes('frozen_record_oracle')));
	}
	const narrowed = await sgaRawRecord();
	const request = narrowed.execution.response.toolResults[0].request as Record<string, unknown>;
	request.params = { ...(request.params as Record<string, string>), LastNGames: '5' };
	assert.ok(evaluateFrozenExecution(narrowed.candidate, narrowed.execution).some((failure) => failure.includes('frozen_record_oracle')));
});

test('SGA aggregate outcome uses W/L identity rather than group position and preserves the 30-point predicate', () => {
	const candidate = evalCase('sga-30-point-record');
	const execution = executionFor(candidate);
	execution.response.toolResults = [{ toolName: 'aggregate_endpoint_rows', request: { endpointId: 'playergamelogs', params: { PlayerID: '1628983', Season: '2025-26', SeasonType: 'Regular Season', PerMode: 'Totals' }, filters: [{ column: 'PTS', op: 'gte', value: 30 }], groupBy: ['WL'] }, response: { ok: true, data: {
		totalRows: 10, matchedRows: 8, groupsTruncated: false, groups: [{ key: { WL: 'L' }, rowCount: 2, aggregates: { 'count:*': 2 } }, { key: { WL: 'W' }, rowCount: 6, aggregates: { 'count:*': 6 } }]
	} } }];
	assert.deepEqual(evaluateFrozenExecution(candidate, execution), []);
	const request = execution.response.toolResults[0].request as Record<string, unknown>;
	request.filters = [{ column: 'PTS', op: 'gte', value: 20 }];
	assert.ok(evaluateFrozenExecution(candidate, execution).some((failure) => failure.includes('frozen_record_oracle')));
});

test('named-defender outcome accepts a named team alternative while keeping guard, warnings and empty artifacts mandatory', () => {
	const candidate = evalCase('named-defender-no-team-fallback');
	const execution = executionFor(candidate);
	execution.response.answer = 'I can’t filter by the named defender, Bam Adebayo. Would you like Scottie Barnes clips against the Miami Heat instead?';
	execution.response.warnings = [{ code: 'dynamic_agent_capability_limit', message: 'Named-defender clip filtering is unavailable.' }];
	execution.response.toolResults = [{ toolName: 'find_video_clips', request: {}, response: { ok: false, error: 'Named-defender clip filtering is unavailable for Bam Adebayo.' } }];
	assert.deepEqual(evaluateFrozenExecution(candidate, execution), []);
	const missingWarning = structuredClone(execution);
	missingWarning.response.warnings = [];
	assert.ok(evaluateFrozenExecution(candidate, missingWarning).some((failure) => failure.includes('required_warning')));
	const broader = structuredClone(execution);
	broader.response.artifacts = [{ type: 'table', shape: 'table', columns: ['team'], rows: [{ team: 'Miami Heat' }] }];
	assert.ok(evaluateFrozenExecution(candidate, broader).some((failure) => failure.includes('frozen_defender_oracle')));
	const fetched = structuredClone(execution);
	fetched.endpointCalls = [{ endpointId: 'videodetailsasset', params: { OpponentTeamID: '1610612748' } }];
	assert.ok(evaluateFrozenExecution(candidate, fetched).some((failure) => failure.includes('endpoint_calls')));
});
