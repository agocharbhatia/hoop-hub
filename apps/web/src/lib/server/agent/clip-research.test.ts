import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDynamicQueryAgent } from './service';
import type { DynamicAgentModelResponse } from './types';
import type { EndpointFetchResult } from '$lib/server/data/adapters/stats-endpoint-client';

/* Fixture helpers */

function endpointResult(endpointId: string, payload: unknown | null): EndpointFetchResult {
	return { endpointId, payload, cacheStatus: 'miss', sourceStatus: payload ? 'ok' : 'timeout', latencyMs: 1, stale: false, isProvisional: false, parserVersion: 'v1' };
}

function createClipResearchAgent(videoAvailable: boolean, repeatRequest = false, options: { dateRange?: { dateFrom?: string; dateTo?: string }; compound?: boolean; refinement?: boolean } = {}) {
	const turns: DynamicAgentModelResponse[] = [
		{ content: null, toolCalls: [{ id: 'clips', name: 'find_video_clips', arguments: JSON.stringify({ playerId: '1630567', season: '2024-25', seasonType: 'Regular Season', eventType: 'custom_shot', ...options.dateRange, customShot: { result: 'made', zone: 'mid_range', actionFamily: 'pull_up', period: 4 } }) }] },
		{ content: null, toolCalls: [] },
		{ content: JSON.stringify({ answer: 'One make in two attempts.', warnings: [], artifacts: [{ type: 'shot_chart', title: 'Fourth-quarter pull-ups', shots: [{ locX: 999, locY: 999, made: true }] }] }), toolCalls: [] }
	];
	if (repeatRequest) turns.splice(1, 0, { ...turns[0]!, toolCalls: turns[0]!.toolCalls.map((call) => ({ ...call, id: 'retry-clips' })) });
	if (options.compound) {
		turns.unshift({ content: null, toolCalls: [{ id: 'stats', name: 'aggregate_endpoint_rows', arguments: JSON.stringify({ endpointId: 'shotchartdetail', params: { PlayerID: '1630567', Season: '2024-25', SeasonType: 'Regular Season' }, filters: [{ column: 'SHOT_ZONE_BASIC', op: 'eq', value: 'Mid-Range' }, { column: 'ACTION_TYPE', op: 'contains', value: 'pull' }, { column: 'PERIOD', op: 'eq', value: 4 }], selectColumns: ['LOC_X', 'LOC_Y', 'SHOT_MADE_FLAG', 'ACTION_TYPE', 'SHOT_TYPE'], rowLimit: 500, aggregations: [{ op: 'count' }, { op: 'sum', column: 'SHOT_MADE_FLAG' }] }) }] });
		turns.push({ ...turns.at(-1)! });
	}
	if (options.refinement) turns.push({ ...turns.at(-1)! });
	return createDynamicQueryAgent({
		model: { async complete() { const turn = turns.shift(); if (!turn) throw new Error('No scripted response'); return turn; } },
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
		teamDirectory: { findByNameOrAlias: () => [] },
		endpointFetcher: async ({ endpointId }) => endpointId === 'shotchartdetail'
			? endpointResult(endpointId, { resultSets: [{ name: 'Shot_Chart_Detail', headers: ['GAME_ID', 'GAME_EVENT_ID', 'GAME_DATE', 'PLAYER_ID', 'PERIOD', 'LOC_X', 'LOC_Y', 'SHOT_MADE_FLAG', 'SHOT_ZONE_BASIC', 'ACTION_TYPE', 'SHOT_TYPE'], rowSet: [
				['0022400001', 7, '20241231', '1630567', 4, 20, 150, 1, 'Mid-Range', 'Pullup Jump Shot', '2PT Field Goal'],
				['0022400001', 8, '20241231', '1630567', 4, -30, 160, 0, 'Mid-Range', 'Pullup Jump Shot', '2PT Field Goal'],
				['0022400001', 9, '20241231', '1630567', 1, 20, 150, 1, 'Mid-Range', 'Pullup Jump Shot', '2PT Field Goal']
			] }] })
			: endpointResult(endpointId, videoAvailable ? { resultSets: { Meta: { videoUrls: [7, 8].map((eventId) => ({ murl: `https://videos.nba.com/nba/pbp/media/2024/12/31/0022400001/${eventId}/video.mp4` })) }, playlist: [7, 8].map((eventId) => ({ gi: '0022400001', ei: eventId, y: 2024, m: 12, d: 31, dsc: `${eventId === 8 ? 'MISS ' : ''}Barnes pull-up` })) } } : null)
	});
}

/* End fixture helpers */

test('custom clip research grounds all attempts, canonical shot identities, and made-only playlist coverage', async () => {
	const response = await createClipResearchAgent(true).answerQuestion('Show fourth-quarter pull-up mid-range FG% and makes clips.');
	const chart = response.artifacts.find((artifact) => artifact.type === 'shot_chart');
	if (chart?.type !== 'shot_chart') assert.fail('Missing shot chart');
	assert.deepEqual(chart.shots.map((shot) => [shot.gameId, shot.eventId, shot.gameDate, shot.period, shot.made]), [
		['0022400001', '7', '2024-12-31', 4, true], ['0022400001', '8', '2024-12-31', 4, false]
	]);
	const playlist = response.artifacts.find((artifact) => artifact.type === 'video_playlist');
	if (playlist?.type !== 'video_playlist') assert.fail('Missing playlist');
	assert.equal(playlist.clips.length, 1);
	assert.equal(playlist.clips[0]?.eventId, '7');
	assert.deepEqual(playlist.coverage, { matchingShotEventCount: 1, joinedClipCount: 1, returnedClipCount: 1, missingVideoCount: 0, invalidJoinKeyCount: 0, playlistCapped: false });
});

test('video source failure preserves research and visibly unavailable playlist coverage', async () => {
	const response = await createClipResearchAgent(false).answerQuestion('Show fourth-quarter pull-up mid-range FG% and makes clips.');
	const chart = response.artifacts.find((artifact) => artifact.type === 'shot_chart');
	if (chart?.type !== 'shot_chart') assert.fail('Missing shot chart');
	assert.equal(chart.shots.length, 2);
	const playlist = response.artifacts.find((artifact) => artifact.type === 'video_playlist');
	if (playlist?.type !== 'video_playlist') assert.fail('Missing coverage artifact');
	assert.equal(playlist.clips.length, 0);
	assert.equal(playlist.coverage?.missingVideoCount, 1);
	assert.ok(response.warnings.some((warning) => warning.code === 'video_coverage_partial'));
});

test('video-only failure retains validated shot scope for subsequent refinements', async () => {
	const agent = createClipResearchAgent(false, false, { refinement: true });
	const initial = await agent.answerQuestion('Show fourth-quarter pull-up mid-range FG% and makes clips in 2024-25.');
	assert.ok(initial.sessionId);
	assert.deepEqual(initial.effectiveScope?.seasons, ['2024-25']);
	const refined = await agent.answerQuestion('Now include misses.', { sessionId: initial.sessionId });
	assert.equal(refined.effectiveScope?.shotResult, 'any');
	assert.equal(refined.effectiveScope?.period, 4);
	assert.deepEqual(refined.effectiveScope?.seasons, ['2024-25']);
	const playlist = refined.artifacts.find((artifact) => artifact.type === 'video_playlist');
	if (playlist?.type !== 'video_playlist') assert.fail('Missing video availability artifact');
	assert.equal(playlist.coverage?.matchingShotEventCount, 2);
	assert.equal(playlist.coverage?.missingVideoCount, 2);
	const chart = refined.artifacts.find((artifact) => artifact.type === 'shot_chart');
	if (chart?.type !== 'shot_chart') assert.fail('Missing grounded shot chart');
	assert.equal(chart.shots.length, 2);
});

test('identical successful clip requests produce one grounded playlist', async () => {
	const response = await createClipResearchAgent(true, true).answerQuestion('Show fourth-quarter pull-up mid-range FG% and makes clips.');
	assert.equal(response.toolResults.filter((result) => result.toolName === 'find_video_clips').length, 2);
	assert.equal(response.artifacts.filter((artifact) => artifact.type === 'video_playlist').length, 1);
});

test('compound stats and clips include-misses refinement expands playlist without changing the chart denominator', async () => {
	const agent = createClipResearchAgent(true, false, { compound: true });
	const initial = await agent.answerQuestion('Show fourth-quarter pull-up mid-range FG% and makes clips in 2024-25.');
	const refined = await agent.answerQuestion('Now include misses.', { sessionId: initial.sessionId });
	const clips = refined.toolResults.find((result) => result.toolName === 'find_video_clips');
	if (!clips || clips.toolName !== 'find_video_clips') assert.fail('Missing replayed clip result');
	assert.equal(clips.response.ok, true, clips.response.error);
	assert.deepEqual(clips.request.customShot, { result: 'any', zone: 'mid_range', actionFamily: 'pull_up', period: 4 });
	const playlist = refined.artifacts.find((artifact) => artifact.type === 'video_playlist');
	if (playlist?.type !== 'video_playlist') assert.fail('Missing refined playlist');
	assert.deepEqual(playlist.clips.map((clip) => clip.eventId), ['7', '8']);
	const chart = refined.artifacts.find((artifact) => artifact.type === 'shot_chart');
	if (chart?.type !== 'shot_chart') assert.fail('Missing refined chart');
	assert.equal(chart.shots.length, 2);
	assert.equal(chart.shots.filter((shot) => shot.made).length, 1);
});

test('clip date scope normalizes US dates and rejects impossible or inverted ranges', async () => {
	const accepted = await createClipResearchAgent(true, false, { dateRange: { dateFrom: '12/31/2024', dateTo: '2024-12-31' } }).answerQuestion('Show fourth-quarter pull-up mid-range makes.');
	const result = accepted.toolResults.find((entry) => entry.toolName === 'find_video_clips');
	if (!result || result.toolName !== 'find_video_clips') assert.fail('Missing date result');
	assert.equal(result.response.ok, true);
	assert.equal(result.request.dateFrom, '2024-12-31');
	for (const dateRange of [{ dateFrom: '2024-02-30' }, { dateFrom: '2024-12-31', dateTo: '2024-01-01' }]) {
		const rejected = await createClipResearchAgent(true, false, { dateRange }).answerQuestion('Show fourth-quarter pull-up mid-range makes.');
		const invalid = rejected.toolResults.find((entry) => entry.toolName === 'find_video_clips');
		if (!invalid || invalid.toolName !== 'find_video_clips') assert.fail('Missing rejected date result');
		assert.equal(invalid.response.ok, false);
		assert.match(invalid.response.error ?? '', /dates must|dateFrom cannot/);
	}
});
