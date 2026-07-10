import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	filterCustomShotEvents,
	joinCustomShotEventsToVideos,
	type CustomShotFilters,
	type CustomShotScope
} from './custom-shot-clips';

const HEADERS = [
	'GAME_ID',
	'GAME_EVENT_ID',
	'PERIOD',
	'EVENT_TYPE',
	'ACTION_TYPE',
	'SHOT_TYPE',
	'SHOT_ZONE_BASIC',
	'SHOT_ZONE_AREA',
	'SHOT_ZONE_RANGE',
	'SHOT_DISTANCE',
	'SHOT_MADE_FLAG',
	'GAME_DATE'
];

type ShotFixture = {
	gameId?: string | null;
	eventId?: string | number | null;
	period?: number;
	action?: string;
	shotType?: string;
	zone?: string;
	zoneArea?: string;
	zoneRange?: string;
	distance?: number;
	made?: 0 | 1;
	gameDate?: string;
};

const SCOPE: CustomShotScope = {
	playerId: '1630173',
	season: '2025-26',
	seasonType: 'Regular Season'
};

/* Test helpers */

function buildShotPayload(shots: ShotFixture[]): unknown {
	return {
		resultSets: [
			{
				name: 'Shot_Chart_Detail',
				headers: HEADERS,
				rowSet: shots.map((shot) => [
					shot.gameId ?? '0022500001',
					shot.eventId ?? '1',
					shot.period ?? 1,
					shot.made === 0 ? 'Missed Shot' : 'Made Shot',
					shot.action ?? 'Pullup Jump shot',
					shot.shotType ?? '3PT Field Goal',
					shot.zone ?? 'Above the Break 3',
					shot.zoneArea ?? 'Center(C)',
					shot.zoneRange ?? '24+ ft.',
					shot.distance ?? 25,
					shot.made ?? 1,
					shot.gameDate ?? '20251022'
				])
			}
		]
	};
}

function buildVideoPayload(
	clips: Array<{ gameId: string | null; eventId: string | null; description?: string; playable?: boolean }>
): unknown {
	return {
		resultSets: {
			Meta: {
				videoUrls: clips.map((clip, index) => ({
					murl: clip.playable === false ? null : `https://videos.nba.com/${index}.mp4`,
					mth: null
				}))
			},
			playlist: clips.map((clip) => ({
				gi: clip.gameId,
				ei: clip.eventId,
				y: 2025,
				m: 10,
				d: 22,
				dsc: clip.description ?? 'Video event'
			}))
		}
	};
}

function filter(shots: ShotFixture[], filters: CustomShotFilters) {
	const filtered = filterCustomShotEvents(buildShotPayload(shots), filters, SCOPE);
	if (!filtered.ok) {
		assert.fail(filtered.error);
	}
	return filtered.data;
}

function join(shots: ShotFixture[], filters: CustomShotFilters, videos: Parameters<typeof buildVideoPayload>[0], cap = 40) {
	const joined = joinCustomShotEventsToVideos(filter(shots, filters), buildVideoPayload(videos), cap);
	if (!joined.ok) {
		assert.fail(joined.error);
	}
	return joined.data;
}

describe('custom shot clip joins', () => {
	test('joins only exact game and event pairs, including the same event id in different games', () => {
		const data = join(
			[
				{ gameId: '0022500001', eventId: '7', action: 'Pullup Jump shot' },
				{ gameId: '0022500002', eventId: '7', action: 'Running Pull-Up Jump Shot' },
				{ gameId: '0022500001', eventId: '8', action: 'Driving Layup Shot', shotType: '2PT Field Goal' }
			],
			{ result: 'made', shotValue: 3, actionFamily: 'pull_up' },
			[
				{ gameId: '0022500001', eventId: '8', description: 'Unrelated layup' },
				{ gameId: '0022500002', eventId: '7', description: 'Second game pull-up' },
				{ gameId: '0022500001', eventId: '7', description: 'First game pull-up' },
				{ gameId: '0022500003', eventId: '7', description: 'Same event id, unrelated game' }
			]
		);

		assert.deepEqual(data.joinedEventIds, [
			{ gameId: '0022500001', eventId: '7' },
			{ gameId: '0022500002', eventId: '7' }
		]);
		assert.deepEqual(
			data.clips.map((clip) => clip.description),
			['First game pull-up', 'Second game pull-up']
		);
		assert.equal(data.matchingShotEventCount, 2);
		assert.equal(data.joinedClipCount, 2);
		assert.equal(data.missingVideoCount, 0);
	});

	test('keeps made and missed events distinct while combining zone and action filters', () => {
		const shots: ShotFixture[] = [
			{ eventId: '1', made: 1, zone: 'Mid-Range', action: 'Pullup Jump shot', shotType: '2PT Field Goal' },
			{ eventId: '2', made: 0, zone: 'Mid-Range', action: 'Pullup Jump shot', shotType: '2PT Field Goal' },
			{ eventId: '3', made: 1, zone: 'Mid-Range', action: 'Fadeaway Jump Shot', shotType: '2PT Field Goal' },
			{ eventId: '4', made: 1, zone: 'Restricted Area', action: 'Pullup Jump shot', shotType: '2PT Field Goal' }
		];

		assert.deepEqual(filter(shots, { result: 'made', zone: 'mid_range', actionFamily: 'pull_up' }).events, [
			{ gameId: '0022500001', eventId: '1', gameDate: '2025-10-22' }
		]);
		assert.deepEqual(filter(shots, { result: 'missed', zone: 'mid_range', actionFamily: 'pull_up' }).events, [
			{ gameId: '0022500001', eventId: '2', gameDate: '2025-10-22' }
		]);
	});

	test('treats malformed keys and absent videos as missing without admitting unrelated clips', () => {
		const data = join(
			[
				{ eventId: '1' },
				{ eventId: '2' },
				{ gameId: 'bad-game', eventId: '3' },
				{ gameId: '0022500001', eventId: 'bad-event' }
			],
			{ result: 'any' },
			[
				{ gameId: '0022500001', eventId: '1', description: 'Only joined video' },
				{ gameId: '0022500009', eventId: '2', description: 'Wrong game' },
				{ gameId: null, eventId: '3', description: 'Missing game id' }
			]
		);

		assert.equal(data.matchingShotEventCount, 4);
		assert.equal(data.joinedClipCount, 1);
		assert.equal(data.missingVideoCount, 3);
		assert.equal(data.invalidJoinKeyCount, 2);
		assert.deepEqual(data.joinedEventIds, [{ gameId: '0022500001', eventId: '1' }]);
	});

	test('applies the playlist cap after filtering and joining an uncapped video feed', () => {
		const matchingShots = Array.from({ length: 45 }, (_, index) => ({
			gameId: '0022500001',
			eventId: String(index + 100)
		}));
		const unrelatedVideos = Array.from({ length: 45 }, (_, index) => ({
			gameId: '0022500009',
			eventId: String(index),
			description: `Unrelated ${index}`
		}));
		const matchingVideos = matchingShots.map((shot, index) => ({
			gameId: shot.gameId,
			eventId: shot.eventId,
			description: `Matching ${index}`
		}));

		const data = join(matchingShots, { result: 'made' }, [...unrelatedVideos, ...matchingVideos], 40);

		assert.equal(data.matchingShotEventCount, 45);
		assert.equal(data.joinedClipCount, 45);
		assert.equal(data.returnedClipCount, 40);
		assert.equal(data.missingVideoCount, 0);
		assert.equal(data.playlistCapped, true);
		assert.equal(data.clips[0]?.description, 'Matching 0');
		assert.equal(data.clips[39]?.description, 'Matching 39');
	});

	test('returns canonical applied filters for grounding', () => {
		const filtered = filter(
			[
				{
					eventId: '9',
					period: 4,
					zone: 'Left Corner 3',
					zoneArea: 'Left Side(L)',
					distance: 23
				}
			],
			{
				result: 'made',
				shotValue: 3,
				zone: 'corner_3',
				zoneArea: 'left',
				period: 4,
				distanceFeetMin: 22,
				distanceFeetMax: 24
			}
		);

		assert.deepEqual(filtered.appliedFilters, {
			eventType: 'custom_shot',
			...SCOPE,
			result: 'made',
			shotValue: 3,
			zone: 'corner_3',
			zoneArea: 'left',
			period: 4,
			distanceFeetMin: 22,
			distanceFeetMax: 24
		});
	});
});
