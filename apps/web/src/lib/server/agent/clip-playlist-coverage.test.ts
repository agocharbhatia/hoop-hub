import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EndpointFetchResult } from '$lib/server/data/adapters/stats-endpoint-client';
import { createDynamicQueryAgent } from './service';
import type { DynamicAgentChatMessage } from './types';

/* Fixture helpers */

async function runPlaylistFixture(eventType: 'made_three' | 'custom_shot', count: number) {
	const eventIds = Array.from({ length: count }, (_, index) => index + 1);
	const gameId = '0022500001';
	const sourcePayload = {
		resultSets: {
			Meta: { videoUrls: eventIds.map((eventId) => ({ murl: `https://videos.nba.com/nba/pbp/media/2025/10/26/${gameId}/${eventId}/video.mp4` })) },
			playlist: eventIds.map((eventId) => ({ gi: gameId, ei: eventId, y: 2025, m: 10, d: 26, dsc: "Leonard 26' 3PT Pullup Jump Shot" }))
		}
	};
	const modelRequests: DynamicAgentChatMessage[][] = [];
	const agent = createDynamicQueryAgent({
		model: {
			async complete(request) {
				modelRequests.push(structuredClone(request.messages));
				if (modelRequests.length === 1) return {
					content: null,
					toolCalls: [{ id: 'clips', name: 'find_video_clips', arguments: JSON.stringify({
						playerId: '202695', season: '2025-26', seasonType: 'Regular Season', eventType,
						...(eventType === 'custom_shot' ? { customShot: { result: 'made', shotValue: 3, actionFamily: 'pull_up' } } : {})
					}) }]
				};
				return { content: JSON.stringify({ answer: `${count} matching clips.`, artifacts: [], warnings: [] }), toolCalls: [] };
			}
		},
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
		teamDirectory: { findByNameOrAlias: () => [] },
		endpointFetcher: async ({ endpointId }): Promise<EndpointFetchResult> => ({
			endpointId, payload: endpointId === 'shotchartdetail' ? {
				resultSets: [{ name: 'Shot_Chart_Detail', headers: ['GAME_ID', 'GAME_EVENT_ID', 'GAME_DATE', 'PLAYER_ID', 'LOC_X', 'LOC_Y', 'SHOT_MADE_FLAG', 'ACTION_TYPE', 'SHOT_TYPE'],
					rowSet: eventIds.map((eventId) => [gameId, eventId, '20251026', '202695', 20, 240, 1, 'Pullup Jump Shot', '3PT Field Goal']) }]
			} : sourcePayload,
			cacheStatus: 'miss', sourceStatus: 'ok', latencyMs: 1, stale: false, isProvisional: false, parserVersion: 'v1'
		})
	});
	const response = await agent.answerQuestion(eventType === 'custom_shot'
		? 'Show all Kawhi Leonard pull-up three-point makes in 2025-26.'
		: 'Show all Kawhi Leonard made three-point clips in 2025-26.');
	const toolMessage = modelRequests.at(-1)?.find((message) => message.role === 'tool' && message.name === 'find_video_clips');
	assert.ok(toolMessage?.content, 'The final model request should contain the clip tool summary.');
	return { response, modelToolContent: toolMessage.content };
}

/* End fixture helpers */

for (const eventType of ['made_three', 'custom_shot'] as const) {
	test(`${eventType} includes all 64 matching clips after the former 40-clip cutoff`, async () => {
		const { response } = await runPlaylistFixture(eventType, 64);
		const playlist = response.artifacts.find((artifact) => artifact.type === 'video_playlist');
		if (playlist?.type !== 'video_playlist') assert.fail('Missing canonical playlist');
		assert.equal(playlist.clips.length, 64);
		assert.deepEqual(playlist.clips.map((clip) => clip.eventId), Array.from({ length: 64 }, (_, index) => String(index + 1)));
		if (eventType === 'custom_shot') {
			assert.equal(playlist.coverage?.returnedClipCount, 64);
			assert.equal(playlist.coverage?.playlistCapped, false);
		}
	});
}

test('clip model context stays compact while full canonical clips and shot rows reach the answer', async () => {
	const small = await runPlaylistFixture('custom_shot', 64);
	const large = await runPlaylistFixture('custom_shot', 1024);
	assert.ok(large.modelToolContent.length < 1500, `Expected a scalar summary, got ${large.modelToolContent.length} characters.`);
	assert.ok(large.modelToolContent.length - small.modelToolContent.length < 40);
	const summary = JSON.parse(large.modelToolContent);
	assert.equal(summary.data.clips, undefined);
	assert.equal(summary.data.researchRows, undefined);
	assert.equal(summary.data.joinedEventIds, undefined);
	assert.equal(summary.data.joinedClipCount, 1024);
	assert.deepEqual(summary.data.shootingSummary, { attempts: 1024, makes: 1024, fgPct: 1 });
	const playlist = large.response.artifacts.find((artifact) => artifact.type === 'video_playlist');
	const chart = large.response.artifacts.find((artifact) => artifact.type === 'shot_chart');
	assert.equal(playlist?.type === 'video_playlist' ? playlist.clips.length : 0, 1024);
	assert.equal(chart?.type === 'shot_chart' ? chart.shots.length : 0, 1024);
});
