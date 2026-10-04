import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { awaitWithSignal, createRunEndpointFetcher } from './query-runtime';
import { createDynamicQueryAgent } from './service';
import { createQuerySessionStore } from './query-session-store';
import type { EndpointFetchResult } from '$lib/server/data/adapters/stats-endpoint-client';
import type { DynamicAgentModelResponse } from './types';
import type { QueryProgress } from '$lib/contracts/query-progress';
import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';

/* Test helpers */

function endpointResult(): EndpointFetchResult {
	return { endpointId: 'playergamelog', payload: { resultSets: [{ name: 'PlayerGameLog', headers: ['GAME_DATE', 'REB'], rowSet: [['2025-01-01', 10], ['2025-01-02', 14]] }] }, cacheStatus: 'miss', sourceStatus: 'ok', latencyMs: 1, stale: false, isProvisional: false, parserVersion: 'test' };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

async function runTrendCompletionScenario(question: string, requestedGames: number, recordedGames: number) {
	const finalModes: boolean[] = [];
	const agent = createDynamicQueryAgent({
		model: { supportsDirectFinalAnswer: true, async complete(input) {
			finalModes.push(Boolean(input.responseFormat));
			if (finalModes.length === 1) return { content: null, toolCalls: [{ id: 'trend', name: 'analyze_time_series', arguments: JSON.stringify({ endpointId: 'playergamelog', params: { PlayerID: '203999', Season: '2024-25' }, dateColumn: 'GAME_DATE', valueColumn: 'REB', lastN: requestedGames }) }] };
			return { content: JSON.stringify({ answer: 'Verified.', artifacts: [], warnings: [] }), toolCalls: [] };
		} },
		endpointFetcher: async () => ({ ...endpointResult(), payload: { resultSets: [{ name: 'PlayerGameLog', headers: ['GAME_DATE', 'REB'], rowSet: Array.from({ length: recordedGames }, (_, index) => [`2025-01-${String(index + 1).padStart(2, '0')}`, index + 1]) }] } }),
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [{ playerId: '203999', canonicalName: 'Nikola Jokic', normalizedName: 'nikola jokic', teamId: null, snapshotVersion: 'test', importedAt: '2026-10-02' }] },
		teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore()
	});
	await agent.answerQuestion(question);
	return finalModes;
}

async function runClipCompletionScenario(question: string) {
	const finalModes: boolean[] = [];
	const agent = createDynamicQueryAgent({
		model: { supportsDirectFinalAnswer: true, async complete(input) {
			finalModes.push(Boolean(input.responseFormat));
			if (finalModes.length === 1) return { content: null, toolCalls: [{ id: 'clips', name: 'find_video_clips', arguments: JSON.stringify({ playerId: '1630567', season: '2024-25', seasonType: 'Regular Season', opponentTeamId: '1610612738', eventType: 'custom_shot', customShot: { result: 'made', zone: 'mid_range', actionFamily: 'pull_up' } }) }] };
			return { content: JSON.stringify({ answer: 'Verified.', artifacts: [], warnings: [] }), toolCalls: [] };
		} },
		endpointFetcher: async ({ endpointId }) => ({ ...endpointResult(), endpointId, payload: endpointId === 'shotchartdetail' ? { resultSets: [{ name: 'Shot_Chart_Detail', headers: ['GAME_ID', 'GAME_EVENT_ID', 'GAME_DATE', 'PLAYER_ID', 'PERIOD', 'LOC_X', 'LOC_Y', 'SHOT_MADE_FLAG', 'SHOT_ZONE_BASIC', 'ACTION_TYPE', 'SHOT_TYPE'], rowSet: [['0022400001', 7, '20241231', '1630567', 4, 20, 150, 1, 'Mid-Range', 'Pullup Jump Shot', '2PT Field Goal']] }] } : { resultSets: { Meta: { videoUrls: [{ murl: 'https://videos.nba.com/nba/pbp/media/2024/12/31/0022400001/7/video.mp4' }] }, playlist: [{ gi: '0022400001', ei: 7, y: 2024, m: 12, d: 31, dsc: 'Barnes pull-up' }] } } }),
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [{ playerId: '1630567', canonicalName: 'Scottie Barnes', normalizedName: 'scottie barnes', teamId: '1610612761', snapshotVersion: 'test', importedAt: '2026-10-02' }] },
		teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore()
	});
	await agent.answerQuestion(question);
	return finalModes;
}

/* End test helpers */

/* Runtime behavior */

describe('research execution latency and cancellation', () => {
	test('repairs an upstream player game window before fetching and keeps one verified population', async () => {
		let calls = 0;
		let fetches = 0;
		const agent = createDynamicQueryAgent({
			model: { async complete() {
				calls++;
				if (calls <= 2) return { content: null, toolCalls: [{ id: `trend-${calls}`, name: 'analyze_time_series', arguments: JSON.stringify({ endpointId: 'playergamelogs', params: { PlayerID: '203999', Season: '2024-25', LastNGames: calls === 1 ? '2' : '0' }, dateColumn: 'GAME_DATE', valueColumn: 'REB', lastN: 2 }) }] };
				return { content: JSON.stringify({ answer: 'Verified.', artifacts: [], warnings: [] }), toolCalls: [] };
			} },
			endpointFetcher: async (request) => { fetches++; assert.equal(request.params.LastNGames, '0'); return { ...endpointResult(), endpointId: 'playergamelogs' }; },
			playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
			teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore()
		});
		const response = await agent.answerQuestion('Show Nikola Jokic rebounds trend in his latest two games in 2024-25.');
		assert.equal(fetches, 1);
		const rejected = response.toolResults[0].response;
		assert.ok('ok' in rejected);
		assert.equal(rejected.ok, false);
		assert.equal(response.status, 'ok');
		assert.equal(response.artifacts.filter((artifact) => artifact.type === 'line_chart').length, 1);
		assert.ok(response.warnings.every((warning) => !warning.message.includes('trend population')));
	});

	test('complete earlier-five/latest-five comparisons retain the direct final optimization', async () => {
		assert.deepEqual(await runTrendCompletionScenario('Show Nikola Jokic rebounds over his final ten games in 2024-25. Compare the earlier five with the latest five and include a chart.', 10, 10), [false, true]);
	});

	for (const [question, requestedGames, recordedGames] of [
		['Show Nikola Jokic rebounds trend over his last ten games in 2024-25.', 2, 2],
		['Show Nikola Jokic rebounds trend over his last ten games in 2024-25.', 10, 2],
		['Show Nikola Jokic rebounds trend in his last two games against Curry in 2024-25.', 2, 2],
		['Compare Nikola Jokic and Curry rebound trends over their last two games in 2024-25.', 2, 2],
		['Show Nikola Jokic rebounds and minutes trends over his last two games in 2024-25.', 2, 2],
		['Show Nikola Jokic rebounds over his final ten games in 2024-25. Compare against Curry and the earlier five with the latest five.', 10, 10]
	] as const) test(`incomplete or compound research retains a planning turn: ${question} (${requestedGames}/${recordedGames})`, async () => {
		assert.deepEqual(await runTrendCompletionScenario(question, requestedGames, recordedGames), [false, false]);
	});

	test('one custom-shot population against Boston retains direct final completion', async () => {
		assert.deepEqual(await runClipCompletionScenario('Show Scottie Barnes’ pull-up mid-range FG% against Boston in the 2024-25 regular season, plot the attempts, and play the available makes.'), [false, true]);
	});

	for (const question of [
		'Show Scottie Barnes made pull-up mid-range clips vs Boston in 2024-25 and his scoring average per game.',
		'Show Scottie Barnes made pull-up mid-range clips vs Boston in 2024-25 over his latest two games.'
	]) test(`compound clip research retains a planning turn: ${question}`, async () => {
		assert.deepEqual(await runClipCompletionScenario(question), [false, false]);
	});

	test('a verified single-player trend skips another planning turn and ignores absent optional display labels', async () => {
		let calls = 0;
		const turns: DynamicAgentModelResponse[] = [
			{ content: null, toolCalls: [{ id: 'trend', name: 'analyze_time_series', arguments: JSON.stringify({ endpointId: 'playergamelog', params: { PlayerID: '203999', Season: '2024-25' }, dateColumn: 'GAME_DATE', valueColumn: 'REB', labelColumns: ['PLAYER_NAME'], lastN: 2 }) }] },
			{ content: JSON.stringify({ answer: 'Verified.', artifacts: [], warnings: [] }), toolCalls: [] }
		];
		const agent = createDynamicQueryAgent({
			model: { supportsDirectFinalAnswer: true, async complete(input) { calls++; if (calls === 2) assert.ok(input.responseFormat); return turns.shift()!; } },
			endpointFetcher: async () => endpointResult(),
			playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [{ playerId: '203999', canonicalName: 'Nikola Jokic', normalizedName: 'nikola jokic', teamId: null, snapshotVersion: 'test', importedAt: '2026-10-02' }] },
			teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore()
		});
		const response = await agent.answerQuestion("Show Nikola Jokic's rebounds trend over his last two games in 2024-25.");
		assert.equal(calls, 2);
		assert.equal(response.status, 'ok');
		assert.match(response.answer, /10.*14/);
		const data = response.toolResults.find((result) => result.toolName === 'analyze_time_series')?.response;
		assert.ok(data && 'data' in data);
		assert.deepEqual((data.data as { omittedLabelColumns: string[] }).omittedLabelColumns, ['PLAYER_NAME']);
	});

	test('shares equivalent concurrent and completed successful endpoint requests', async () => {
		let fetches = 0;
		const gate = deferred<EndpointFetchResult>();
		const fetcher = createRunEndpointFetcher(async () => { fetches++; return gate.promise; }, new AbortController().signal, () => {});
		const first = fetcher({ endpointId: 'playergamelog', params: { PlayerID: '1', Season: '2024-25' } });
		const second = fetcher({ endpointId: 'playergamelog', params: { Season: '2024-25', PlayerID: '1', SeasonType: 'Regular Season' } });
		assert.equal(fetches, 1);
		gate.resolve(endpointResult());
		assert.equal(await first, await second);
		await fetcher({ endpointId: 'playergamelog', params: { PlayerID: '1', Season: '2024-25' } });
		assert.equal(fetches, 1);
	});

	test('does not memoize failed populations and passes cancellation to the transport', async () => {
		const controller = new AbortController();
		let fetches = 0;
		const fetcher = createRunEndpointFetcher(async (request) => {
			assert.equal(request.signal, controller.signal);
			fetches++;
			return { ...endpointResult(), payload: null, sourceStatus: 'timeout' };
		}, controller.signal, () => {});
		await fetcher({ endpointId: 'playergamelog', params: { PlayerID: '1' } });
		await fetcher({ endpointId: 'playergamelog', params: { PlayerID: '1' } });
		assert.equal(fetches, 2);
		controller.abort();
		assert.throws(() => fetcher({ endpointId: 'playergamelog', params: { PlayerID: '1' } }), { name: 'AbortError' });
	});

	test('cancels a waiting injected operation promptly', async () => {
		const controller = new AbortController();
		const waiting = awaitWithSignal(new Promise(() => {}), controller.signal);
		controller.abort();
		await assert.rejects(waiting, { name: 'AbortError' });
	});

	test('keeps the remaining activity visible when a parallel task finishes', async () => {
		const gates = [deferred<EndpointFetchResult>(), deferred<EndpointFetchResult>()];
		const bothStarted = deferred<void>();
		const firstComplete = deferred<void>();
		const progress: QueryProgress[] = [];
		let sourceCalls = 0;
		let modelCalls = 0;
		const agent = createDynamicQueryAgent({
			model: { async complete() {
				if (modelCalls++ === 0) return { content: null, toolCalls: ['1', '2'].map((id) => ({ id, name: 'analyze_time_series', arguments: JSON.stringify({ endpointId: 'playergamelog', params: { PlayerID: id, Season: '2024-25' }, dateColumn: 'GAME_DATE', valueColumn: 'REB', lastN: 2 }) })) };
				return { content: JSON.stringify({ answer: 'Verified source results.', artifacts: [], warnings: [] }), toolCalls: [] };
			} },
			endpointFetcher: async (request) => {
				if (++sourceCalls === 2) bothStarted.resolve();
				return gates[Number(request.params.PlayerID) - 1].promise;
			},
			playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
			teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore()
		});
		const answer = agent.answerQuestion('Get both game logs for 2024-25.', { onProgress(update) {
			progress.push(update);
			if (update.completedTools === 1) firstComplete.resolve();
		} });
		await bothStarted.promise;
		gates[0].resolve(endpointResult());
		await firstComplete.promise;
		assert.equal(progress.at(-1)?.stage, 'computing', 'the other computation is still in progress');
		assert.equal(progress.at(-1)?.message, 'Working out the numbers');
		assert.equal(progress.some((update) => update.message === 'Reviewing what we found'), false);
		gates[1].resolve(endpointResult());
		await answer;
		assert.ok(progress.some((update) => update.message === 'Reviewing what we found'));
		assert.equal(progress.at(-1)?.message, 'Putting your answer together');
	});

	test('runs independent populations together, streams verified charts, and reuses a terminal final answer', async () => {
		let calls = 0;
		const started: string[] = [];
		const sourceGate = deferred<EndpointFetchResult>();
		const snapshots: QueryAnswerArtifact[][] = [];
		const stages: string[] = [];
		const modelTurns: DynamicAgentModelResponse[] = [
			{ content: null, toolCalls: ['1', '2'].map((id) => ({ id, name: 'analyze_time_series', arguments: JSON.stringify({ endpointId: 'playergamelog', params: { PlayerID: id, Season: '2024-25' }, dateColumn: 'GAME_DATE', valueColumn: 'REB', lastN: 2 }) })) },
			{ content: JSON.stringify({ answer: 'Verified source results.', artifacts: [], warnings: [] }), toolCalls: [] }
		];
		const agent = createDynamicQueryAgent({
			model: { async complete() { calls++; return modelTurns.shift()!; } },
			endpointFetcher: async (request) => { started.push(request.params.PlayerID); if (started.length === 2) sourceGate.resolve(endpointResult()); return sourceGate.promise; },
			playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
			teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore()
		});
		await agent.answerQuestion('Get both game logs for 2024-25.', { onProgress: (progress) => stages.push(progress.stage), onArtifacts: (artifacts) => snapshots.push(artifacts) });
		assert.deepEqual(started, ['1', '2']);
		assert.equal(calls, 2, 'the structured terminal turn must not require another model call');
		assert.ok(stages.includes('computing') && stages.includes('fetching') && stages.includes('writing'));
		assert.ok(snapshots.length >= 1);
		assert.ok(snapshots.flat().some((artifact) => artifact.type === 'line_chart' && artifact.series[0]?.points.length === 2));
	});
});
