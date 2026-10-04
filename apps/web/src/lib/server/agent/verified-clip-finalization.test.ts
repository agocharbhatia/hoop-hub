import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDynamicQueryAgent } from './service';
import { DynamicAgentError, type DynamicAgentModelResponse } from './types';
import { getQueryTraceById } from '$lib/server/semantic/trace-store';

/* Fixture helpers */

function createAgent(questionComplete = true) {
	const final: DynamicAgentModelResponse = { content: '{"answer":"Found the shots","artifacts":[', toolCalls: [] };
	const turns: DynamicAgentModelResponse[] = [
		{ content: null, toolCalls: [{ id: 'clips', name: 'find_video_clips', arguments: JSON.stringify({ playerId: '202695', eventType: 'custom_shot', season: '2025-26', seasonType: 'Regular Season', customShot: { result: 'made', shotValue: 3, actionFamily: 'pull_up' } }) }] },
		...(questionComplete ? [] : [{ content: null, toolCalls: [] }]), final
	];
	return createDynamicQueryAgent({
		now: () => new Date('2026-10-03T12:00:00Z'),
		model: { supportsDirectFinalAnswer: true, async complete() { const turn = turns.shift(); assert.ok(turn); return turn; } },
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: (name) => /Kawhi/i.test(name) ? [{ playerId: '202695', canonicalName: 'Kawhi Leonard', normalizedName: 'kawhi leonard', teamId: null, snapshotVersion: 'test', importedAt: '2026-10-03T12:00:00Z' }] : [] },
		teamDirectory: { findByNameOrAlias: () => [] },
		endpointFetcher: async ({ endpointId }) => ({ endpointId, cacheStatus: 'hit', sourceStatus: 'ok', latencyMs: 1, stale: false, isProvisional: false, parserVersion: 'v1', payload: endpointId === 'shotchartdetail'
			? { resultSets: [{ name: 'Shot_Chart_Detail', headers: ['GAME_ID', 'GAME_EVENT_ID', 'GAME_DATE', 'PLAYER_ID', 'PERIOD', 'LOC_X', 'LOC_Y', 'SHOT_MADE_FLAG', 'SHOT_ZONE_BASIC', 'ACTION_TYPE', 'SHOT_TYPE'], rowSet: [
				['0022500001', 7, '20251103', '202695', 1, 20, 250, 1, 'Above the Break 3', 'Pullup Jump Shot', '3PT Field Goal'],
				['0022500001', 8, '20251103', '202695', 1, 25, 255, 0, 'Above the Break 3', 'Pullup Jump Shot', '3PT Field Goal']
			] }] }
			: { resultSets: { Meta: { videoUrls: [{ murl: 'https://videos.nba.com/nba/pbp/media/2025/11/03/0022500001/7/video.mp4' }] }, playlist: [{ gi: '0022500001', ei: 7, y: 2025, m: 11, d: 3, dsc: 'Leonard 3PT Pullup Jump Shot' }] } }
		})
	});
}

/* End fixture helpers */

test('a malformed narration cannot strand complete canonical clip research', async () => {
	const response = await createAgent().answerQuestion('Show all Kawhi Leonard pull-up three-point makes this season.');
	assert.equal(response.status, 'ok');
	assert.ok(response.sessionId);
	assert.match(response.answer, /Kawhi Leonard/);
	const playlist = response.artifacts.find((artifact) => artifact.type === 'video_playlist');
	assert.equal(playlist?.type === 'video_playlist' ? playlist.clips[0]?.eventId : null, '7');
	const chart = response.artifacts.find((artifact) => artifact.type === 'shot_chart');
	assert.equal(chart?.type === 'shot_chart' ? chart.shots.length : 0, 2);
	assert.ok(getQueryTraceById(response.traceId)?.warnings.some((warning) => warning.code === 'dynamic_agent_final_output_recovered'));
});

test('malformed narration still fails when the requested compound research is incomplete', async () => {
	await assert.rejects(() => createAgent(false).answerQuestion('Show Kawhi Leonard pull-up three-point makes and also his assists this season.'),
		(error) => error instanceof DynamicAgentError && error.code === 'invalid_model_output');
});
