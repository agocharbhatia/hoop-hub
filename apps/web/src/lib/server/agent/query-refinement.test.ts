import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
import type { EndpointFetchResult } from '$lib/server/data/adapters/stats-endpoint-client';
import { createDynamicQueryAgent } from './service';
import { deriveResearchRefinement, summarizeResearchScope } from './query-refinement';
import { createQuerySessionStore, QuerySessionExpiredError, type GroundedResearchContext } from './query-session-store';
import type { GroundedResearchRequest } from './research-context';
import type { DynamicAgentCompletionInput, DynamicAgentModelResponse } from './types';

const researchRequest: GroundedResearchRequest = {
	toolName: 'aggregate_endpoint_rows',
	request: {
		endpointId: 'shotchartdetail',
		params: { PlayerID: '1630173', Season: '2025-26', SeasonType: 'Regular Season', OpponentTeamID: '1610612738' },
		resultSetName: 'Shot_Chart_Detail',
		filters: [
			{ column: 'SHOT_ZONE_BASIC', op: 'eq', value: 'Mid-Range' },
			{ column: 'ACTION_TYPE', op: 'contains', value: 'pull' },
			{ column: 'SHOT_MADE_FLAG', op: 'eq', value: 1 }
		],
		selectColumns: ['LOC_X', 'LOC_Y', 'SHOT_MADE_FLAG', 'SHOT_TYPE', 'ACTION_TYPE'],
		aggregations: [{ op: 'count' }, { op: 'sum', column: 'SHOT_MADE_FLAG' }]
	}
};

describe('grounded research refinements', () => {
	test('replays a filtered population through misses, period and season comparison without model scope drift', async () => {
		const inputs: DynamicAgentCompletionInput[] = [];
		const artifacts: QueryAnswerArtifact[] = [{ type: 'shot_chart', title: 'Filtered shots', shots: [] }];
		const scripted = [
			toolResponse(researchRequest), emptyResponse(), finalResponse(artifacts),
			finalResponse(artifacts), finalResponse(artifacts), finalResponse(artifacts)
		];
		const fetched: Array<Record<string, string>> = [];
		const agent = createDynamicQueryAgent({
			model: { async complete(input) { inputs.push(input); return scripted.shift() ?? assert.fail('Unexpected model call'); } },
			endpointFetcher: async (request) => { fetched.push(request.params); return shotResult(request.params.Season); },
			playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
			teamDirectory: { findByNameOrAlias: () => [] },
			sessionStore: createQuerySessionStore(),
			now: () => new Date('2026-04-15T12:00:00Z')
		});
		const initial = await agent.answerQuestion('Show Barnes made pull-up mid-range shots against Boston in 2025-26.');
		assert.ok(initial.sessionId);
		const misses = await agent.answerQuestion('Now include misses.', { sessionId: initial.sessionId });
		const missesResult = misses.toolResults.find((result) => result.toolName === 'aggregate_endpoint_rows');
		assert.equal(readAggregateCount(missesResult && 'data' in missesResult.response ? missesResult.response.data : undefined), 3);
		const quarter = await agent.answerQuestion('only fourth quarters', { sessionId: initial.sessionId });
		const quarterResult = quarter.toolResults.find((result) => result.toolName === 'aggregate_endpoint_rows');
		assert.equal(readAggregateCount(quarterResult && 'data' in quarterResult.response ? quarterResult.response.data : undefined), 2);
		assert.equal(quarter.effectiveScope?.period, 4);
		const comparison = await agent.answerQuestion('compare with 2023-24', { sessionId: initial.sessionId });
		assert.deepEqual(comparison.effectiveScope?.seasons, ['2025-26', '2023-24']);
		assert.deepEqual(comparison.effectiveScope?.opponentTeamIds, ['1610612738']);
		assert.deepEqual(fetched.map((params) => params.Season), ['2025-26', '2025-26', '2025-26', '2025-26', '2023-24']);
		assert.equal(fetched.slice(2).every((params) => params.Period === '4'), true);
		const table = comparison.artifacts.find((artifact) => artifact.type === 'table');
		assert.equal(table?.type, 'table');
		if (table?.type !== 'table') assert.fail('Expected canonical season comparison table');
		assert.deepEqual(table.rows.map((row) => [row.season, row.sampleSize, row.fgPct]), [['2025-26', 2, 0.5], ['2023-24', 2, 1]]);
		const shots = comparison.artifacts.filter((artifact) => artifact.type === 'shot_chart');
		assert.deepEqual(shots.map((artifact) => [artifact.source?.population?.season, artifact.shots.filter((shot) => shot.made).length]), [['2025-26', 1], ['2023-24', 2]]);
		assert.equal(shots.every((artifact) => artifact.title.includes(String(artifact.source?.population?.season))), true);
		assert.equal(inputs.length, 6, 'Each deterministic refinement needs only a final rendering model call');
		assert.ok(inputs[0].messages.some((message) => message.role === 'system' && /2026-04-15/.test(message.content ?? '')));
	});

	test('keeps the prior successful scope after an unavailable question', async () => {
		let unavailable = false;
		const scripted = [toolResponse(researchRequest), emptyResponse(), finalResponse([]),
			toolResponse({ ...researchRequest, request: { ...researchRequest.request, params: { PlayerID: '999', Season: '2024-25' } } }),
			emptyResponse(), finalResponse([]), finalResponse([])];
		const fetched: Array<Record<string, string>> = [];
		const agent = createDynamicQueryAgent({
			model: { async complete() { return scripted.shift() ?? assert.fail('Unexpected model call'); } },
			endpointFetcher: async (request) => {
				fetched.push(request.params);
				return unavailable ? { ...shotResult(request.params.Season), payload: null, sourceStatus: 'error' } : shotResult(request.params.Season);
			},
			playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
			teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore()
		});
		const initial = await agent.answerQuestion('Barnes pull-up mid-range makes');
		unavailable = true;
		const failure = await agent.answerQuestion('Different player in 2024-25', { sessionId: initial.sessionId });
		assert.equal(failure.status, 'coverage_gap');
		assert.equal(failure.effectiveScope, undefined, 'A failed unrelated turn must not display the prior scope as its own evidence');
		unavailable = false;
		const restored = await agent.answerQuestion('include misses', { sessionId: initial.sessionId });
		assert.deepEqual(restored.effectiveScope?.playerIds, ['1630173']);
		assert.equal(fetched.at(-1)?.PlayerID, '1630173');
		assert.equal(fetched.at(-1)?.Season, '2025-26');
	});

	test('retains direct three-point scope when including misses and refuses unsupported or ambiguous replays', () => {
		const clips: GroundedResearchRequest = { toolName: 'find_video_clips', request: { playerId: '1', eventType: 'made_three', season: '2025-26', seasonType: 'Regular Season', opponentTeamId: '2' } };
		const result = deriveResearchRefinement('include misses', [clips]);
		assert.deepEqual(result?.requests[0], { toolName: 'find_video_clips', request: { ...clips.request, eventType: 'custom_shot', customShot: { shotValue: 3, result: 'any' } } });
		assert.equal(deriveResearchRefinement('include misses for Curry instead', [clips]), null);
		assert.equal(deriveResearchRefinement('compare with 2023-27', [clips]), null);
		assert.equal(deriveResearchRefinement('only fourth quarters', [{ toolName: 'execute_semantic_query', request: { query: { operation: 'lookup', entity: 'player', subject: { ids: ['1'] }, metrics: ['ast'], filters: { season: '2025-26' } } } }]), null);
	});

	test('refuses season replay when row filters identify an original date, game or season', () => {
		assert.equal(researchRequest.toolName, 'aggregate_endpoint_rows');
		if (researchRequest.toolName !== 'aggregate_endpoint_rows') assert.fail('Expected aggregate request');
		for (const column of ['GAME_DATE', 'GAME_DATE_EST', 'GAME_ID', 'GAME_EVENT_ID', 'SEASON', 'SEASON_ID', 'SEASON_YEAR']) {
			const entry: GroundedResearchRequest = { ...researchRequest, request: {
				...researchRequest.request, filters: [{ column, op: 'eq', value: 'original' }]
			} };
			assert.equal(deriveResearchRefinement('compare with 2023-24', [entry]), null, column);
		}
	});

	test('describes validated player, opponent and shared shot filters without duplicate labels', () => {
		const clips: GroundedResearchRequest = { toolName: 'find_video_clips', request: {
			playerId: '1630173', eventType: 'custom_shot', season: '2025-26', seasonType: 'Regular Season',
			opponentTeamId: '1610612738', dateFrom: '2026-01-01', dateTo: '2026-02-01',
			customShot: { actionFamily: 'pull_up', zone: 'mid_range', result: 'made', period: 4 }
		} };
		const scope = summarizeResearchScope([researchRequest, clips], [{ id: '1630173', canonicalName: 'Scottie Barnes', teamId: '1610612761' }]);
		assert.deepEqual(scope.players, [{ id: '1630173', name: 'Scottie Barnes' }]);
		assert.deepEqual(scope.opponents, [{ id: '1610612738', name: 'Boston Celtics' }]);
		assert.deepEqual(scope.shotFilters, ['Mid-range', 'Pull-up']);
		assert.deepEqual(scope.seasonTypes, ['Regular Season']);
		assert.equal(scope.period, 4);
		assert.equal(scope.shotResult, 'made');
		assert.equal(scope.dateFrom, '2026-01-01');
		assert.equal(scope.dateTo, '2026-02-01');
	});
});

describe('bounded local research sessions', () => {
	test('isolates snapshots, retains four turns, expires idle sessions and evicts least-recently used sessions', () => {
		let time = 0;
		const store = createQuerySessionStore({ nowMs: () => time, ttlMs: 100, maxSessions: 2 });
		const context = sampleContext();
		const a = store.load(); store.save(a.sessionId, context);
		const b = store.load(); store.save(b.sessionId, context);
		const loaded = store.load(a.sessionId);
		assert.equal(loaded.context?.questions.length, 4);
		if (loaded.context) loaded.context.questions[0] = 'changed';
		assert.notEqual(store.load(a.sessionId).context?.questions[0], 'changed');
		const c = store.load(); store.save(c.sessionId, context);
		assert.throws(() => store.load(b.sessionId), QuerySessionExpiredError);
		time = 100;
		assert.throws(() => store.load(a.sessionId), QuerySessionExpiredError);
	});

	test('rejects oversized contexts without replacing successful prior scope', () => {
		const store = createQuerySessionStore(); const a = store.load();
		store.save(a.sessionId, sampleContext());
		assert.equal(store.save(a.sessionId, { ...sampleContext(), questions: ['x'.repeat(30_000)] }), false);
		assert.equal(store.load(a.sessionId).context?.requests.length, 1);
		assert.equal(store.save(a.sessionId, { ...sampleContext(), requests: Array(13).fill(researchRequest) }), false);
	});
});

/* Test helpers */

function toolResponse(entry: GroundedResearchRequest): DynamicAgentModelResponse {
	return { content: null, toolCalls: [{ id: crypto.randomUUID(), name: entry.toolName, arguments: JSON.stringify(entry.request) }] };
}

function emptyResponse(): DynamicAgentModelResponse { return { content: null, toolCalls: [] }; }

function finalResponse(artifacts: QueryAnswerArtifact[]): DynamicAgentModelResponse {
	return { content: JSON.stringify({ answer: 'Results for the requested scope.', artifacts, warnings: [] }), toolCalls: [] };
}

function shotResult(season = '2025-26'): EndpointFetchResult {
	return { endpointId: 'shotchartdetail', payload: { resultSets: [{ name: 'Shot_Chart_Detail',
		headers: ['SHOT_ZONE_BASIC', 'ACTION_TYPE', 'SHOT_MADE_FLAG', 'LOC_X', 'LOC_Y', 'PERIOD', 'GAME_ID', 'GAME_EVENT_ID', 'SHOT_TYPE'],
		rowSet: [
			['Mid-Range', 'Pullup Jump Shot', 1, 20, 120, 4, season === '2025-26' ? '001' : '002', 1, '2PT Field Goal'],
			['Mid-Range', 'Pullup Jump Shot', season === '2025-26' ? 0 : 1, 30, 150, 4, season === '2025-26' ? '001' : '002', 2, '2PT Field Goal'],
			['Mid-Range', 'Pullup Jump Shot', 1, 40, 160, 1, '001', 3, '2PT Field Goal'],
			['Mid-Range', 'Catch Shot', 1, 50, 170, 4, '001', 4, '2PT Field Goal']
		] }] }, cacheStatus: 'miss', sourceStatus: 'ok', latencyMs: 1, stale: false, isProvisional: false, parserVersion: 'test' };
}

function readAggregateCount(value: unknown): number {
	return (value as { groups: Array<{ rowCount: number }> }).groups[0].rowCount;
}

function sampleContext(): GroundedResearchContext {
	return { questions: ['a', 'b', 'c', 'd', 'e'], requests: [researchRequest], players: [],
		scope: { seasons: ['2025-26'], playerIds: ['1630173'], teamIds: [], opponentTeamIds: ['1610612738'] } };
}

/* End test helpers */
