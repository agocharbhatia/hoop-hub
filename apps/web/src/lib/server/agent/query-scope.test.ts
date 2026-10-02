import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SemanticQueryRequest } from '$lib/contracts/semantic-query';
import { createDynamicQueryAgent } from './service';
import { createQuerySessionStore } from './query-session-store';
import type { DynamicAgentModelResponse } from './types';

describe('dynamic query scope', () => {
	test('pins current season to the injected date, blocks season substitutions and removes recovered coverage warnings', async () => {
		let fetched = 0;
		let semanticSeason: string | null | undefined;
		const scripted = [call('execute_semantic_query', { query: {
			operation: 'rank', entity: 'player', subject: {}, metrics: ['ast'], filters: {}, limit: 5, outputMode: 'table'
		} }), call('call_nba_stats_endpoint', { endpointId: 'leaguedashplayerstats', params: { Season: '2024-25' } }),
		call('call_nba_stats_endpoint', { endpointId: 'leaguedashplayerstats', params: { Season: '2025-26' } }),
		{ content: null, toolCalls: [] }, final([{ kind: 'partial_data', message: 'The preliminary stored data was unavailable.' }])];
		const agent = createDynamicQueryAgent({
			model: { async complete() { return scripted.shift() ?? assert.fail('Unexpected model call'); } },
			endpointFetcher: async (request) => {
				fetched += 1; assert.equal(request.params.Season, '2025-26');
				return { endpointId: request.endpointId, payload: { resultSets: [{ name: 'LeagueDashPlayerStats', headers: ['PLAYER_NAME', 'AST'], rowSet: [['Player', 8]] }] },
					cacheStatus: 'miss', sourceStatus: 'ok', latencyMs: 1, stale: false, isProvisional: false, parserVersion: 'test' };
			},
			semanticExecutor: async (request) => {
				semanticSeason = request.query.filters.season;
				return { status: 'coverage_gap', result: null, provenance: { executor: 'semantic_executor', resolvedQuery: request.query, sourceCalls: [], dataFreshnessMode: 'nightly' },
					citations: [], warnings: [{ code: 'nightly_data_unavailable', message: 'Fixture unavailable' }], traceId: 'semantic' };
			},
			playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
			teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore(), now: () => new Date('2026-04-15T12:00:00Z')
		});
		const answer = await agent.answerQuestion('Top five assists leaders this season.');
		assert.equal(semanticSeason, '2025-26'); assert.equal(fetched, 1);
		assert.equal(answer.status, 'ok'); assert.deepEqual(answer.warnings, []);
		assert.deepEqual(answer.effectiveScope?.seasons, ['2025-26']);
		const rejected = answer.toolResults.find((result) => result.toolName === 'call_nba_stats_endpoint' && 'ok' in result.response && !result.response.ok);
		assert.ok(rejected && 'error' in rejected.response && /would change the research scope/.test(rejected.response.error ?? ''));
	});

	test('compares canonical semantic subjects with distinct season table rows and chart values', async () => {
		const query: SemanticQueryRequest = { query: { operation: 'lookup', entity: 'player', subject: { names: ['Barnes'] }, metrics: ['pts'], filters: { season: null, seasonType: 'Regular Season' } } };
		const scripted = [call('execute_semantic_query', query), { content: null, toolCalls: [] }, final([]), final([])];
		const executed: SemanticQueryRequest[] = [];
		const agent = createDynamicQueryAgent({
			model: { async complete() { return scripted.shift() ?? assert.fail('Unexpected model call'); } },
			endpointFetcher: async () => { throw new Error('Unused'); },
			semanticExecutor: async (request) => {
				executed.push(structuredClone(request));
				return { status: 'ok', result: { shape: 'table', columns: ['playerName', 'pts'], rows: [{ playerName: 'Scottie Barnes', pts: request.query.filters.season === '2025-26' ? 20 : 18 }] },
					provenance: { executor: 'semantic_executor', resolvedQuery: { ...request.query, subject: { ids: ['1630173'], names: ['Scottie Barnes'] } }, sourceCalls: [], dataFreshnessMode: 'nightly' },
					citations: [], warnings: [], traceId: crypto.randomUUID() };
			},
			playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
			teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore()
		});
		const initial = await agent.answerQuestion('Barnes points in 2025-26');
		assert.deepEqual(initial.effectiveScope?.seasons, ['2025-26'], JSON.stringify(initial.toolResults));
		const comparison = await agent.answerQuestion('Compare with 2023-24.', { sessionId: initial.sessionId });
		assert.deepEqual(executed.slice(1).map((request) => request.query.subject.ids), [['1630173'], ['1630173']]);
		const table = comparison.artifacts.find((artifact) => artifact.type === 'table');
		if (table?.type !== 'table') assert.fail('Expected canonical comparison table');
		assert.deepEqual(table.rows.map((row) => [row.season, row.pts]), [['2025-26', 20], ['2023-24', 18]]);
		const chart = comparison.artifacts.find((artifact) => artifact.type === 'line_chart');
		if (chart?.type !== 'line_chart') assert.fail('Expected canonical comparison chart');
		assert.deepEqual(chart.series[0].points, [{ x: '2025-26', y: 20 }, { x: '2023-24', y: 18 }]);
	});
});

/* Test helpers */

function call(name: string, args: unknown): DynamicAgentModelResponse {
	return { content: null, toolCalls: [{ id: crypto.randomUUID(), name, arguments: JSON.stringify(args) }] };
}

function final(warnings: unknown[]): DynamicAgentModelResponse {
	return { content: JSON.stringify({ answer: 'The requested values.', artifacts: [], warnings }), toolCalls: [] };
}

/* End test helpers */
