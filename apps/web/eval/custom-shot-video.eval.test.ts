import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EndpointFetchResult, StatsEndpointFetcher } from '$lib/server/data/adapters/stats-endpoint-client';
import { createDynamicQueryAgent } from '$lib/server/agent/service';
import type {
	DynamicAgentAdapter,
	DynamicAgentModelResponse,
	DynamicAgentPlayerDirectory,
	DynamicAgentTeamDirectory
} from '$lib/server/agent/types';

type CanonicalCustomVideoIntent = {
	playerId: string;
	eventType: 'custom_shot';
	season: string;
	seasonType: 'Regular Season';
	opponentTeamId?: string;
	customShot: Record<string, unknown>;
};

type EvalShot = {
	gameId: string;
	eventId: string;
	action: string;
	shotType: string;
	zone: string;
	zoneArea?: string;
	made: 0 | 1;
	period?: number;
};

type EvalCase = {
	name: string;
	questions: string[];
	intent: CanonicalCustomVideoIntent;
	shots: EvalShot[];
	videoEventKeys: string[];
	expectedJoinedEventKeys: string[];
	expectedMatchingCount: number;
	expectedMissingCount: number;
};

const BASE_INTENT = {
	playerId: '1630567',
	eventType: 'custom_shot',
	season: '2025-26',
	seasonType: 'Regular Season'
} as const;

const EVAL_CASES: EvalCase[] = [
	{
		name: 'pull-up mid-range makes and paraphrases',
		questions: [
			"Show Scottie Barnes' pull-up mid-range makes.",
			'Play Barnes made pull-up jumpers from mid-range.',
			'I want video of Scottie hitting mid-range pull-ups.'
		],
		intent: {
			...BASE_INTENT,
			customShot: { result: 'made', shotValue: 2, zone: 'mid_range', actionFamily: 'pull_up' }
		},
		shots: [
			{
				gameId: '0022500001',
				eventId: '10',
				action: 'Pullup Jump shot',
				shotType: '2PT Field Goal',
				zone: 'Mid-Range',
				made: 1
			},
			{
				gameId: '0022500001',
				eventId: '11',
				action: 'Fadeaway Jump Shot',
				shotType: '2PT Field Goal',
				zone: 'Mid-Range',
				made: 1
			}
		],
		videoEventKeys: ['0022500001:10', '0022500001:11'],
		expectedJoinedEventKeys: ['0022500001:10'],
		expectedMatchingCount: 1,
		expectedMissingCount: 0
	},
	{
		name: 'step-back threes',
		questions: ["Show Curry's step-back threes."],
		intent: {
			...BASE_INTENT,
			playerId: '201939',
			customShot: { result: 'made', shotValue: 3, actionFamily: 'step_back' }
		},
		shots: [
			{
				gameId: '0022500002',
				eventId: '20',
				action: 'Step Back Jump shot',
				shotType: '3PT Field Goal',
				zone: 'Above the Break 3',
				made: 1
			},
			{
				gameId: '0022500002',
				eventId: '21',
				action: 'Pullup Jump shot',
				shotType: '3PT Field Goal',
				zone: 'Above the Break 3',
				made: 1
			}
		],
		videoEventKeys: ['0022500002:20', '0022500002:21'],
		expectedJoinedEventKeys: ['0022500002:20'],
		expectedMatchingCount: 1,
		expectedMissingCount: 0
	},
	{
		name: 'left-corner threes',
		questions: ["Show Barnes' made shots from the left corner."],
		intent: {
			...BASE_INTENT,
			customShot: { result: 'made', shotValue: 3, zone: 'left_corner_3' }
		},
		shots: [
			{
				gameId: '0022500003',
				eventId: '30',
				action: 'Jump Shot',
				shotType: '3PT Field Goal',
				zone: 'Left Corner 3',
				zoneArea: 'Left Side(L)',
				made: 1
			},
			{
				gameId: '0022500003',
				eventId: '31',
				action: 'Jump Shot',
				shotType: '3PT Field Goal',
				zone: 'Right Corner 3',
				zoneArea: 'Right Side(R)',
				made: 1
			}
		],
		videoEventKeys: ['0022500003:30', '0022500003:31'],
		expectedJoinedEventKeys: ['0022500003:30'],
		expectedMatchingCount: 1,
		expectedMissingCount: 0
	},
	{
		name: 'deliberately empty custom combination',
		questions: ['Show missed step-back threes from the restricted area.'],
		intent: {
			...BASE_INTENT,
			customShot: { result: 'missed', shotValue: 3, zone: 'restricted_area', actionFamily: 'step_back' }
		},
		shots: [
			{
				gameId: '0022500004',
				eventId: '40',
				action: 'Step Back Jump shot',
				shotType: '3PT Field Goal',
				zone: 'Above the Break 3',
				made: 0
			}
		],
		videoEventKeys: ['0022500004:40'],
		expectedJoinedEventKeys: [],
		expectedMatchingCount: 0,
		expectedMissingCount: 0
	},
	{
		name: 'partial video join',
		questions: ['Show driving layups against Boston.'],
		intent: {
			...BASE_INTENT,
			opponentTeamId: '1610612738',
			customShot: { result: 'made', shotValue: 2, actionFamily: 'driving_layup' }
		},
		shots: [
			{
				gameId: '0022500005',
				eventId: '50',
				action: 'Driving Layup Shot',
				shotType: '2PT Field Goal',
				zone: 'Restricted Area',
				made: 1
			},
			{
				gameId: '0022500005',
				eventId: '51',
				action: 'Driving Finger Roll Layup Shot',
				shotType: '2PT Field Goal',
				zone: 'Restricted Area',
				made: 1
			}
		],
		videoEventKeys: ['0022500005:50'],
		expectedJoinedEventKeys: ['0022500005:50'],
		expectedMatchingCount: 2,
		expectedMissingCount: 1
	}
];

/* Eval helpers */

function createEvalModel(intent: CanonicalCustomVideoIntent): DynamicAgentAdapter {
	const responses: DynamicAgentModelResponse[] = [
		{
			content: null,
			toolCalls: [{ id: 'custom-video-eval', name: 'find_video_clips', arguments: JSON.stringify(intent) }]
		},
		{ content: null, toolCalls: [] },
		{
			content: JSON.stringify({ answer: 'Eval complete.', artifacts: [], warnings: [] }),
			toolCalls: []
		}
	];
	return {
		async complete() {
			const response = responses.shift();
			if (!response) {
				throw new Error('Eval model exhausted its scripted turns.');
			}
			return response;
		}
	};
}

function buildEndpointResult(endpointId: string, payload: unknown): EndpointFetchResult {
	return {
		endpointId,
		payload,
		cacheStatus: 'hit',
		sourceStatus: 'ok',
		latencyMs: 1,
		stale: false,
		isProvisional: false,
		parserVersion: 'v1'
	};
}

function buildShotPayload(shots: EvalShot[]): unknown {
	return {
		resultSets: [
			{
				name: 'Shot_Chart_Detail',
				headers: [
					'GAME_ID',
					'GAME_EVENT_ID',
					'PERIOD',
					'ACTION_TYPE',
					'SHOT_TYPE',
					'SHOT_ZONE_BASIC',
					'SHOT_ZONE_AREA',
					'SHOT_MADE_FLAG',
					'GAME_DATE'
				],
				rowSet: shots.map((shot) => [
					shot.gameId,
					shot.eventId,
					shot.period ?? 1,
					shot.action,
					shot.shotType,
					shot.zone,
					shot.zoneArea ?? 'Center(C)',
					shot.made,
					'20251022'
				])
			}
		]
	};
}

function buildVideoPayload(eventKeys: string[]): unknown {
	return {
		resultSets: {
			Meta: {
				videoUrls: eventKeys.map((key) => ({ murl: `https://videos.nba.com/${key.replace(':', '-')}.mp4`, mth: null }))
			},
			playlist: eventKeys.map((key) => {
				const [gameId, eventId] = key.split(':');
				return { gi: gameId, ei: eventId, y: 2025, m: 10, d: 22, dsc: key };
			})
		}
	};
}

const PLAYER_DIRECTORY: DynamicAgentPlayerDirectory = {
	ensureAvailable: () => ({ ok: true }),
	findByNameOrAlias: () => []
};

const TEAM_DIRECTORY: DynamicAgentTeamDirectory = {
	findByNameOrAlias: () => []
};

describe('custom shot video contract eval', () => {
	for (const evalCase of EVAL_CASES) {
		for (const question of evalCase.questions) {
			test(`${evalCase.name}: ${question}`, async () => {
				const endpointIds: string[] = [];
				const endpointFetcher: StatsEndpointFetcher = async (request) => {
					endpointIds.push(request.endpointId);
					return request.endpointId === 'shotchartdetail'
						? buildEndpointResult(request.endpointId, buildShotPayload(evalCase.shots))
						: buildEndpointResult(request.endpointId, buildVideoPayload(evalCase.videoEventKeys));
				};
				const agent = createDynamicQueryAgent({
					model: createEvalModel(evalCase.intent),
					endpointFetcher,
					playerDirectory: PLAYER_DIRECTORY,
					teamDirectory: TEAM_DIRECTORY
				});

				const response = await agent.answerQuestion(question);
				const toolResult = response.toolResults.find((result) => result.toolName === 'find_video_clips');
				if (!toolResult || toolResult.toolName !== 'find_video_clips' || !toolResult.response.ok) {
					assert.fail('Expected a successful custom-shot tool result.');
				}
				assert.deepEqual(toolResult.request, evalCase.intent);
				const data = toolResult.response.data as {
					joinedEventIds: Array<{ gameId: string; eventId: string }>;
					matchingShotEventCount: number;
					missingVideoCount: number;
					clips: unknown[];
				};
				assert.deepEqual(
					data.joinedEventIds.map(({ gameId, eventId }) => `${gameId}:${eventId}`),
					evalCase.expectedJoinedEventKeys
				);
				assert.equal(data.matchingShotEventCount, evalCase.expectedMatchingCount);
				assert.equal(data.missingVideoCount, evalCase.expectedMissingCount);
				assert.equal(endpointIds.filter((endpointId) => endpointId === 'shotchartdetail').length, 1);
				assert.ok(endpointIds.filter((endpointId) => endpointId === 'videodetailsasset').length <= 1);
				const playlist = response.artifacts.find((artifact) => artifact.type === 'video_playlist');
				assert.deepEqual(playlist?.type === 'video_playlist' ? playlist.clips : [], data.clips);
				if (evalCase.expectedMissingCount === 0) {
					assert.deepEqual(response.warnings, []);
				} else {
					assert.deepEqual(response.warnings.map((warning) => warning.code), ['video_coverage_partial']);
				}
			});
		}
	}
});
