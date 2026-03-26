import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetDataStoreForTests } from '$lib/server/data/store';
import {
	extractPlayerDirectoryExactNameMentions,
	ensurePlayerDirectoryAvailable,
	findPlayerDirectoryEntriesByExactName,
	findPlayerDirectoryEntriesByNameOrAlias,
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

	test('extracts exact-name mentions from the full seeded player directory', () => {
		const matches = extractPlayerDirectoryExactNameMentions(
			'Compare Stephen Curry vs Precious Achiuwa by points in 2023-24'
		);

		assert.deepEqual(matches, ['Stephen Curry', 'Precious Achiuwa']);
	});

	test('resolves curated aliases through the shared player directory overlay', () => {
		assert.equal(ensurePlayerDirectoryAvailable().ok, true);
		const matches = findPlayerDirectoryEntriesByNameOrAlias('steph');

		assert.deepEqual(
			matches.map((match) => ({ playerId: match.playerId, canonicalName: match.canonicalName })),
			[{ playerId: '201939', canonicalName: 'Stephen Curry' }]
		);
	});

	test('surfaces ambiguous curated aliases without guessing a canonical player', () => {
		assert.equal(ensurePlayerDirectoryAvailable().ok, true);
		const matches = findPlayerDirectoryEntriesByNameOrAlias('williams');

		assert.deepEqual(
			matches.map((match) => match.canonicalName),
			['Grant Williams', 'Kenrich Williams', 'Lou Williams', 'Patrick Williams']
		);
	});

	test('extracts curated alias mentions from the shared player directory overlay', () => {
		const matches = extractPlayerDirectoryExactNameMentions('Show Steph trend for points in the last 2 games');

		assert.deepEqual(matches, ['Stephen Curry']);
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
