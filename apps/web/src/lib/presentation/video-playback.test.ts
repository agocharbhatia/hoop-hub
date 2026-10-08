import assert from 'node:assert/strict';
import { test } from 'node:test';
import { videoPlaybackUrl, videoPlaylistEmptyMessage } from './video-playback';

test('saved NBA clip URLs get a stable fresh cache key without changing their event or asset', () => {
	const original = 'https://videos.nba.com/nba/pbp/media/2025/11/23/0022500278/216/63141117-653a-fe60-62dd-2bc593b097e1_960x540.mp4';
	const playback = videoPlaybackUrl(original);
	assert.equal(new URL(playback).pathname, new URL(original).pathname);
	assert.equal(new URL(playback).origin, new URL(original).origin);
	assert.equal(new URL(playback).searchParams.get('hoop_hub_media'), 'referrer-v1');
	assert.equal(videoPlaybackUrl(original), playback);
	assert.equal(videoPlaybackUrl(playback), playback);
});

test('cache repair leaves other media sources and existing upstream parameters intact', () => {
	for (const original of [
		'https://example.com/video.mp4',
		'https://videos.nba.com.example.com/nba/pbp/media/clip.mp4',
		'https://videos.nba.com/manage/video.mp4',
		'https://videos.nba.com/nba/pbp/media/clip.mp4?token=existing',
		'https://user:secret@videos.nba.com/nba/pbp/media/clip.mp4',
		'/local.mp4', 'invalid-url'
	]) assert.equal(videoPlaybackUrl(original), original);
});

test('empty playlists explain lookup failures without asserting footage does not exist', () => {
	const coverage = { matchingShotEventCount: 64, joinedClipCount: 0, returnedClipCount: 0, missingVideoCount: 64, playlistCapped: false };
	assert.match(videoPlaylistEmptyMessage({ ...coverage, videoAvailability: 'links_missing' }), /NBA did not return video links/);
	assert.match(videoPlaylistEmptyMessage({ ...coverage, videoAvailability: 'source_unavailable' }), /could not retrieve/);
	// Previously saved answers have coverage counts without the new lookup status.
	assert.match(videoPlaylistEmptyMessage(coverage), /NBA did not return video links/);
	assert.equal(videoPlaylistEmptyMessage({ ...coverage, matchingShotEventCount: 0 }), 'No matching video clips were found.');
});
