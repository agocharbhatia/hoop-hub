import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetDataStoreForTests } from '$lib/server/data/store';
import {
	ensurePlayerDirectoryAvailable,
	findPlayerDirectoryEntriesByExactName,
	findPlayerDirectoryEntryById,
	refreshPlayerDirectorySnapshot,
	setPlayerDirectoryRefreshLoaderForTests,
	validateStructuredPlayerSubjectPairs
} from './player-directory';

describe('player-directory', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		resetDataStoreForTests();
	});

	afterEach(() => {
		setPlayerDirectoryRefreshLoaderForTests(null);
		resetDataStoreForTests();
	});

	test('resolves persisted exact-name lookups from the seeded full player directory', () => {
		assert.equal(ensurePlayerDirectoryAvailable().ok, true);
		const matches = findPlayerDirectoryEntriesByExactName('precious achiuwa');

		assert.equal(matches.length, 1);
		assert.equal(matches[0]?.playerId, '1630173');
		assert.equal(matches[0]?.canonicalName, 'Precious Achiuwa');
	});

	test('resolves persisted player ids to canonical identity records', () => {
		assert.equal(ensurePlayerDirectoryAvailable().ok, true);
		const player = findPlayerDirectoryEntryById('1630173');

		assert.equal(player?.canonicalName, 'Precious Achiuwa');
		assert.equal(player?.normalizedName, 'precious achiuwa');
	});

	test('rejects structured id-name pairs that conflict with canonical directory data', () => {
		assert.equal(ensurePlayerDirectoryAvailable().ok, true);
		const error = validateStructuredPlayerSubjectPairs({
			ids: ['1630173'],
			names: ['Stephen Curry']
		});

		assert.match(error ?? '', /same canonical player/i);
	});

	test('returns an explicit availability failure when refresh is disallowed and no stored snapshot exists', () => {
		const result = ensurePlayerDirectoryAvailable({ allowRefresh: false });

		assert.equal(result.ok, false);
		assert.match(result.message ?? '', /disabled by request policy/i);
	});

	test('falls back to the stored snapshot when refresh fails after a prior successful load', () => {
		assert.equal(ensurePlayerDirectoryAvailable().ok, true);
		setPlayerDirectoryRefreshLoaderForTests(() => {
			throw new Error('refresh unavailable');
		});

		const result = refreshPlayerDirectorySnapshot();

		assert.equal(result.ok, true);
		assert.equal(result.source, 'stored');
		assert.equal(findPlayerDirectoryEntryById('1630173')?.canonicalName, 'Precious Achiuwa');
	});
});
