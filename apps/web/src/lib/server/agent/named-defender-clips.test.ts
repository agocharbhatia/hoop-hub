import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDynamicQueryAgent } from './service';
import type { DynamicAgentModelResponse } from './types';

/* Fixture helpers */

async function requestClips(question: string, options: { playerId?: string; resolveDefender?: boolean; eventType?: 'made_field_goal' | 'custom_shot' } = {}) {
	const names = options.resolveDefender === false ? ['Scottie Barnes'] : ['Scottie Barnes', 'Jayson Tatum', 'Bam Adebayo'];
	const turns: DynamicAgentModelResponse[] = [
		{ content: null, toolCalls: [{ id: 'players', name: 'resolve_players', arguments: JSON.stringify({ names }) }] },
		{ content: null, toolCalls: [{ id: 'clips', name: 'find_video_clips', arguments: JSON.stringify({ playerId: options.playerId ?? '1630567', eventType: options.eventType ?? 'custom_shot', season: '2024-25', seasonType: 'Regular Season', ...(options.eventType === 'made_field_goal' ? {} : { customShot: { result: 'made' } }) }) }] },
		{ content: null, toolCalls: [] },
		{ content: JSON.stringify({ answer: 'Clip filtering result.', artifacts: [], warnings: [] }), toolCalls: [] }
	];
	const ids: Record<string, string> = { 'Scottie Barnes': '1630567', 'Jayson Tatum': '1628369', 'Bam Adebayo': '1628389' };
	let fetches = 0;
	const agent = createDynamicQueryAgent({
		model: { async complete() { return turns.shift() ?? assert.fail('Unexpected model call'); } },
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: (name) => [{ playerId: ids[name], canonicalName: name, normalizedName: name.toLowerCase(), teamId: null, snapshotVersion: 'test', importedAt: '2024-12-31T00:00:00Z' }] },
		teamDirectory: { findByNameOrAlias: () => [] },
		endpointFetcher: async ({ endpointId }) => {
			fetches += 1;
			return { endpointId, payload: endpointId === 'shotchartdetail'
				? { resultSets: [{ name: 'Shot_Chart_Detail', headers: ['GAME_ID', 'GAME_EVENT_ID', 'SHOT_MADE_FLAG'], rowSet: [['0022400001', 7, 1]] }] }
				: { resultSets: { Meta: { videoUrls: [] }, playlist: [] } },
				cacheStatus: 'miss', sourceStatus: 'ok', latencyMs: 1, stale: false, isProvisional: false, parserVersion: 'v1' };
		}
	});
	const response = await agent.answerQuestion(question);
	const result = response.toolResults.find((entry) => entry.toolName === 'find_video_clips');
	if (!result || result.toolName !== 'find_video_clips') assert.fail('Missing clip result');
	return { result, fetches, response };
}

/* End fixture helpers */

test('rejects named-defender attribution without an opponent team before any source fetch', async () => {
	for (const question of [
		'Show Scottie Barnes made shots guarded by Bam Adebayo in 2024-25.',
		'Show Scottie Barnes made shots against Bam Adebayo in 2024-25.',
		'Show Barnes makes defended by Bam in 2024-25.'
	]) {
		for (const eventType of ['custom_shot', 'made_field_goal'] as const) {
			const { result, fetches, response } = await requestClips(question, { eventType });
			assert.equal(result.response.ok, false);
			assert.match(result.response.error ?? '', /Named-defender.*Bam Adebayo/);
			assert.equal(fetches, 0);
			assert.equal(response.artifacts.length, 0);
			assert.deepEqual(response.warnings, [{ code: 'dynamic_agent_capability_limit', message: result.response.error }]);
		}
	}
});

test('explicit defender attribution remains blocked if resolution is omitted or offensive role is swapped', async () => {
	const unresolved = await requestClips('Show Scottie Barnes made shots guarded by Bam Adebayo in 2024-25.', { resolveDefender: false });
	assert.equal(unresolved.result.response.ok, false);
	assert.equal(unresolved.fetches, 0);
	const swapped = await requestClips('Show Scottie Barnes made shots guarded by Bam Adebayo in 2024-25.', { playerId: '1628389' });
	assert.match(swapped.result.response.error ?? '', /Bam Adebayo/);
	assert.equal(swapped.fetches, 0);
});

test('resolving several players does not block ordinary separate-player highlights', async () => {
	const { result, fetches } = await requestClips('Show Scottie Barnes and Bam Adebayo made shots in 2024-25.');
	assert.equal(result.response.ok, true, result.response.error);
	assert.equal(fetches, 2);
});
