import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findExplicitCustomShotCue, findUnsupportedClipClockScope, validateExplicitClipDistance } from './clip-question-scope';
import { createDynamicQueryAgent } from './service';
import { DynamicAgentError } from './types';
import type { CustomShotFilters } from './custom-shot-clips';

for (const [phrase, bounds] of [
	['from at least 30 feet', { distanceFeetMin: 30 }],
	['from >= 30 ft', { distanceFeetMin: 30 }],
	['from 30+ feet', { distanceFeetMin: 30 }],
	['from 30 feet or more', { distanceFeetMin: 30 }],
	['from at most 30 feet', { distanceFeetMax: 30 }],
	['from <= 30 ft', { distanceFeetMax: 30 }],
	['within 29.5 feet', { distanceFeetMax: 29.5 }],
	['between 25 and 30 feet', { distanceFeetMin: 25, distanceFeetMax: 30 }],
	['from 25 to 30 feet', { distanceFeetMin: 25, distanceFeetMax: 30 }],
	['from 25–30 feet', { distanceFeetMin: 25, distanceFeetMax: 30 }],
	['at least 25 feet and at most 30 feet', { distanceFeetMin: 25, distanceFeetMax: 30 }]
] as const) {
	test(`preserves the explicit inclusive distance: ${phrase}`, () => {
		const question = `Show Kawhi Leonard pull-up three-point makes ${phrase}.`;
		assert.equal(validateExplicitClipDistance(question, { result: 'made', ...bounds }), null);
		assert.match(validateExplicitClipDistance(question, { result: 'made' }) ?? '', /exact shot-distance bounds/);
		assert.notEqual(validateExplicitClipDistance(question, { result: 'made', distanceFeetMin: 10, distanceFeetMax: 40 }), null);
	});
}

test('ambiguous, conflicting and non-foot distance constraints require clarification', () => {
	for (const phrase of ['over 30 feet', 'under 30 feet', 'from 30 feet', '30-foot shots', 'between 30 and 25 feet', 'at least 30 feet and at most 25 feet', 'at least 30 feet and at least 40 feet', 'at least 30 meters', 'at least 100 feet']) {
		assert.notEqual(validateExplicitClipDistance(phrase, { result: 'made', distanceFeetMin: 30 }), null, phrase);
	}
	assert.equal(validateExplicitClipDistance('Show pull-up threes this season.', { result: 'made' }), null);
});

test('clock constraints unsupported by clip filters cannot become broader clips', () => {
	for (const phrase of ['in clutch situations', 'in the first half', 'with 5 seconds left', 'in the final two minutes', 'with the shot clock expiring', 'game-winning shots']) assert.ok(findUnsupportedClipClockScope(phrase), phrase);
	assert.equal(findUnsupportedClipClockScope('in the fourth quarter'), null);
});

test('direct event feeds remain eligible only for simple shot and play scopes', () => {
	for (const phrase of ['pull-up makes', 'step-back threes', 'mid-range makes', 'left corner threes', 'three-point misses', 'in the first quarter']) assert.ok(findExplicitCustomShotCue(phrase), phrase);
	for (const phrase of ['made threes', 'made field goals', 'all assists', 'all rebounds', 'all blocks']) assert.equal(findExplicitCustomShotCue(phrase), null, phrase);
});

test('malformed narration cannot recover a clip lookup that dropped an explicit distance', async () => {
	const fixture = createFixture({ result: 'made', shotValue: 3, actionFamily: 'pull_up' });
	await assert.rejects(() => fixture.agent.answerQuestion('Show all Kawhi Leonard pull-up three-point makes from at least 30 feet this season.'), (error) => error instanceof DynamicAgentError && error.code === 'invalid_model_output');
	assert.equal(fixture.sourceCalls(), 0);
});

test('matching explicit distance retains recovery and filters exact canonical rows', async () => {
	const fixture = createFixture({ result: 'made', shotValue: 3, actionFamily: 'pull_up', distanceFeetMin: 30 });
	const response = await fixture.agent.answerQuestion('Show all Kawhi Leonard pull-up three-point makes from at least 30 feet this season.');
	const playlist = response.artifacts.find((artifact) => artifact.type === 'video_playlist');
	assert.equal(playlist?.type === 'video_playlist' ? playlist.clips.length : 0, 1);
	assert.equal(playlist?.type === 'video_playlist' ? playlist.clips[0].eventId : null, '8');
	assert.equal(fixture.sourceCalls(), 2);
});

test('clutch filtering fails before source lookup even with otherwise exact shot filters', async () => {
	const fixture = createFixture({ result: 'made', shotValue: 3, actionFamily: 'pull_up' });
	await assert.rejects(() => fixture.agent.answerQuestion('Show all Kawhi Leonard pull-up three-point makes in clutch situations this season.'), (error) => error instanceof DynamicAgentError && error.code === 'invalid_model_output');
	assert.equal(fixture.sourceCalls(), 0);
});

test('direct clips cannot drop a requested action, location, miss, quarter or distance', async () => {
	for (const phrase of ['pull-up three-point makes', 'step-back three-point makes', 'mid-range makes', 'left corner makes', 'three-point misses', 'makes in the first quarter', 'makes from at least 30 feet']) {
		const fixture = createFixture(undefined, { eventType: 'made_three' });
		await assert.rejects(() => fixture.agent.answerQuestion(`Show Kawhi Leonard ${phrase} this season.`), (error) => error instanceof DynamicAgentError && error.code === 'invalid_model_output');
		assert.equal(fixture.sourceCalls(), 0, phrase);
	}
});

test('malformed narration cannot recover an opponent scope whose team identity is unproved', async () => {
	const fixture = createFixture({ result: 'made', shotValue: 3, actionFamily: 'pull_up' }, { opponentTeamId: '1610612747' });
	await assert.rejects(() => fixture.agent.answerQuestion('Show Kawhi Leonard pull-up three-point makes against Boston this season.'), (error) => error instanceof DynamicAgentError && error.code === 'invalid_model_output');
	assert.equal(fixture.sourceCalls(), 2);
});

test('malformed narration cannot recover action or location cues the current proof does not check', async () => {
	for (const phrase of ['dunks', 'hook shots', 'jump shots from the paint', 'contested pull-up threes']) {
		const fixture = createFixture({ result: 'made', shotValue: 3, actionFamily: 'pull_up' });
		await assert.rejects(() => fixture.agent.answerQuestion(`Show Kawhi Leonard made ${phrase} this season.`), (error) => error instanceof DynamicAgentError && error.code === 'invalid_model_output');
	}
});

/* Fixture helpers */

function createFixture(customShot: CustomShotFilters | undefined, options: { eventType?: 'made_three'; opponentTeamId?: string } = {}) {
	let calls = 0;
	let sourceCalls = 0;
	return {
		sourceCalls: () => sourceCalls,
		agent: createDynamicQueryAgent({
			now: () => new Date('2026-10-03T12:00:00Z'),
			model: { supportsDirectFinalAnswer: true, async complete() {
				return calls++ === 0 ? { content: null, toolCalls: [{ id: 'clips', name: 'find_video_clips', arguments: JSON.stringify({ playerId: '202695', eventType: options.eventType ?? 'custom_shot', season: '2025-26', seasonType: 'Regular Season', customShot, ...(options.opponentTeamId ? { opponentTeamId: options.opponentTeamId } : {}) }) }] }
					: { content: '{"answer":"Found shots","artifacts":[', toolCalls: [] };
			} },
			playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: (name) => /Kawhi/i.test(name) ? [{ playerId: '202695', canonicalName: 'Kawhi Leonard', normalizedName: 'kawhi leonard', teamId: null, snapshotVersion: 'test', importedAt: '2026-10-03T12:00:00Z' }] : [] },
			teamDirectory: { findByNameOrAlias: () => [] },
			endpointFetcher: async ({ endpointId }) => {
				sourceCalls++;
				return { endpointId, cacheStatus: 'hit', sourceStatus: 'ok', latencyMs: 1, stale: false, isProvisional: false, parserVersion: 'v1', payload: endpointId === 'shotchartdetail'
					? { resultSets: [{ name: 'Shot_Chart_Detail', headers: ['GAME_ID', 'GAME_EVENT_ID', 'GAME_DATE', 'PLAYER_ID', 'PERIOD', 'LOC_X', 'LOC_Y', 'SHOT_MADE_FLAG', 'SHOT_ZONE_BASIC', 'ACTION_TYPE', 'SHOT_TYPE', 'SHOT_DISTANCE'], rowSet: [7, 8].map((id) => ['0022500001', id, '20251103', '202695', 1, 20, 250, 1, 'Above the Break 3', 'Pullup Jump Shot', '3PT Field Goal', id === 7 ? 26 : 31]) }] }
					: { resultSets: { Meta: { videoUrls: [7, 8].map((id) => ({ murl: `https://videos.nba.com/nba/pbp/media/2025/11/03/0022500001/${id}/video.mp4` })) }, playlist: [7, 8].map((id) => ({ gi: '0022500001', ei: id, y: 2025, m: 11, d: 3, dsc: 'Leonard 3PT Pullup Jump Shot' })) } } };
			}
		})
	};
}

/* End fixture helpers */
