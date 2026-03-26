import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetDataStoreForTests } from '$lib/server/data/store';
import {
	findPlayerDirectoryEntriesByExactName,
	findPlayerDirectoryEntryById,
	validateStructuredPlayerSubjectPairs
} from './player-directory';

describe('player-directory', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		resetDataStoreForTests();
	});

	afterEach(() => {
		resetDataStoreForTests();
	});

	test('resolves persisted exact-name lookups from the seeded full player directory', () => {
		const matches = findPlayerDirectoryEntriesByExactName('precious achiuwa');

		assert.equal(matches.length, 1);
		assert.equal(matches[0]?.playerId, '1630173');
		assert.equal(matches[0]?.canonicalName, 'Precious Achiuwa');
	});

	test('resolves persisted player ids to canonical identity records', () => {
		const player = findPlayerDirectoryEntryById('1630173');

		assert.equal(player?.canonicalName, 'Precious Achiuwa');
		assert.equal(player?.normalizedName, 'precious achiuwa');
	});

	test('rejects structured id-name pairs that conflict with canonical directory data', () => {
		const error = validateStructuredPlayerSubjectPairs({
			ids: ['1630173'],
			names: ['Stephen Curry']
		});

		assert.match(error ?? '', /same canonical player/i);
	});
});
