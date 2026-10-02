import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseVideoDetailsAssetClips } from './video-clips';

function buildPayload(videoUrls: unknown[], playlist: unknown[]): unknown {
	return {
		resultSets: {
			Meta: { videoUrls },
			playlist
		}
	};
}

describe('parseVideoDetailsAssetClips', () => {
	test('supports balanced legacy feeds and prefers a valid murl over lurl over surl', () => {
		const parsed = parseVideoDetailsAssetClips(
			buildPayload(
				[
					{ surl: 'https://videos.nba.com/small-1.mp4', lurl: 'https://videos.nba.com/large-1.mp4', murl: 'https://videos.nba.com/medium-1.mp4', mth: 'https://videos.nba.com/thumb-1.jpg' },
					{ surl: 'https://videos.nba.com/small-2.mp4', lurl: 'https://videos.nba.com/large-2.mp4', murl: null, mth: null },
					{ surl: 'https://videos.nba.com/small-3.mp4', lurl: null, murl: null }
				],
				[
					{ gi: '0042500101', ei: 7, y: 2026, m: 5, d: 3, dsc: 'Tatum driving layup' },
					{ gi: '0042500102', ei: '8', y: '2026', m: '5', d: '5', dsc: 'Tatum pullup three' },
					{ gi: '0042500103', ei: '9', y: 2026, m: 5, d: 7, dsc: 'Tatum dunk' }
				]
			)
		);

		if (!parsed.ok) {
			assert.fail(parsed.error);
		}
		assert.deepEqual(parsed.data.clips, [
			{
				url: 'https://videos.nba.com/medium-1.mp4',
				description: 'Tatum driving layup',
				thumbnailUrl: 'https://videos.nba.com/thumb-1.jpg',
				gameDate: '2026-05-03',
				gameId: '0042500101',
				eventId: '7'
			},
			{
				url: 'https://videos.nba.com/large-2.mp4',
				description: 'Tatum pullup three',
				thumbnailUrl: null,
				gameDate: '2026-05-05',
				gameId: '0042500102',
				eventId: '8'
			},
			{
				url: 'https://videos.nba.com/small-3.mp4',
				description: 'Tatum dunk',
				thumbnailUrl: null,
				gameDate: '2026-05-07',
				gameId: '0042500103',
				eventId: '9'
			}
		]);
		assert.equal(parsed.data.totalAvailable, 3);
		assert.equal(parsed.data.truncated, false);
	});

	test('skips playlist entries without a playable url', () => {
		const parsed = parseVideoDetailsAssetClips(
			buildPayload(
				[
					{ surl: '', lurl: null, murl: null, mth: 'https://videos.nba.com/missing.jpg' },
					{ surl: 'https://videos.nba.com/small.mp4', lurl: null, murl: null }
				],
				[
					{ gi: '0042500101', ei: '1', y: 2026, m: 5, d: 3, dsc: 'No video' },
					{ gi: '0042500101', ei: '2', y: 2026, m: 5, d: 3, dsc: 'Has video' }
				]
			)
		);

		if (!parsed.ok) {
			assert.fail(parsed.error);
		}
		assert.equal(parsed.data.clips.length, 1);
		assert.equal(parsed.data.clips[0]?.description, 'Has video');
		assert.equal(parsed.data.totalAvailable, 1);
	});

	test('caps returned clips at 40 with a truncated flag', () => {
		const videoUrls = Array.from({ length: 45 }, (_, index) => ({ murl: `https://videos.nba.com/clip-${index}.mp4`, mth: null }));
		const playlist = Array.from({ length: 45 }, (_, index) => ({
			gi: `00425001${String(index).padStart(2, '0')}`,
			ei: String(index),
			y: 2026,
			m: 5,
			d: 3,
			dsc: `Clip ${index}`
		}));

		const parsed = parseVideoDetailsAssetClips(buildPayload(videoUrls, playlist));

		if (!parsed.ok) {
			assert.fail(parsed.error);
		}
		assert.equal(parsed.data.clips.length, 40);
		assert.equal(parsed.data.totalAvailable, 45);
		assert.equal(parsed.data.truncated, true);
	});

	test('returns a clean parser error for malformed payloads', () => {
		const parsed = parseVideoDetailsAssetClips({ resultSets: { Meta: {}, playlist: [] } });

		assert.equal(parsed.ok, false);
		if (parsed.ok) {
			assert.fail('Expected parser failure.');
		}
		assert.match(parsed.error, /videodetailsasset payload/i);
	});

	test('joins canonical media provenance even when URL and event arrays have different order and length', () => {
		const parsed = parseVideoDetailsAssetClips(buildPayload([
			{ murl: 'https://videos.nba.com/nba/pbp/media/2026/05/03/0042500101/8/video.mp4' },
			{ murl: 'https://videos.nba.com/nba/pbp/media/2026/05/03/0042500101/7/video.mp4' },
			{ murl: 'https://videos.nba.com/nba/pbp/media/2026/05/03/0042500101/99/video.mp4' }
		], [
			{ gi: '0042500101', ei: 7, dsc: 'First shot' },
			{ gi: '0042500101', ei: 8, dsc: 'Second shot' }
		]));
		if (!parsed.ok) assert.fail(parsed.error);
		assert.deepEqual(parsed.data.clips.map((clip) => [clip.eventId, clip.description]), [['8', 'Second shot'], ['7', 'First shot']]);
	});

	test('rejects unsafe URLs and unidentifiable unbalanced legacy arrays', () => {
		const events = [{ gi: '0042500101', ei: 7, dsc: 'Shot' }];
		const unsafe = parseVideoDetailsAssetClips(buildPayload([{ murl: 'javascript:alert(1)', lurl: 'https://videos.nba.com/valid.mp4' }], events));
		if (!unsafe.ok) assert.fail(unsafe.error);
		assert.equal(unsafe.data.clips[0]?.url, 'https://videos.nba.com/valid.mp4');
		const unbalanced = parseVideoDetailsAssetClips(buildPayload([{ murl: 'https://videos.nba.com/unknown.mp4' }], [...events, ...events]));
		if (!unbalanced.ok) assert.fail(unbalanced.error);
		assert.equal(unbalanced.data.clips.length, 0);
	});
});
