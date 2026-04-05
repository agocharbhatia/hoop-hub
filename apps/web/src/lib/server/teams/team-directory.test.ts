import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	findTeamDirectoryEntriesByNameOrAlias,
	findTeamDirectoryEntryById,
	validateStructuredTeamSubjectPairs
} from './team-directory';

describe('team-directory', () => {
	test('resolves canonical team names to shared identity records', () => {
		const matches = findTeamDirectoryEntriesByNameOrAlias('Boston Celtics');

		assert.deepEqual(
			matches.map((match) => ({ teamId: match.teamId, canonicalName: match.canonicalName })),
			[{ teamId: '1610612738', canonicalName: 'Boston Celtics' }]
		);
	});

	test('resolves city names, short names, abbreviations, and curated aliases', () => {
		assert.deepEqual(
			findTeamDirectoryEntriesByNameOrAlias('Boston').map((match) => match.canonicalName),
			['Boston Celtics']
		);
		assert.deepEqual(
			findTeamDirectoryEntriesByNameOrAlias('Knicks').map((match) => match.canonicalName),
			['New York Knicks']
		);
		assert.deepEqual(
			findTeamDirectoryEntriesByNameOrAlias('MIN').map((match) => match.canonicalName),
			['Minnesota Timberwolves']
		);
		assert.deepEqual(
			findTeamDirectoryEntriesByNameOrAlias('Wolves').map((match) => match.canonicalName),
			['Minnesota Timberwolves']
		);
	});

	test('surfaces ambiguous team inputs without guessing a canonical team', () => {
		assert.deepEqual(
			findTeamDirectoryEntriesByNameOrAlias('Los Angeles').map((match) => match.canonicalName),
			['Los Angeles Clippers', 'Los Angeles Lakers']
		);
		assert.deepEqual(
			findTeamDirectoryEntriesByNameOrAlias('LA').map((match) => match.canonicalName),
			['Los Angeles Clippers', 'Los Angeles Lakers']
		);
	});

	test('resolves persisted team ids to canonical identity records', () => {
		const team = findTeamDirectoryEntryById('1610612752');

		assert.equal(team?.canonicalName, 'New York Knicks');
		assert.equal(team?.normalizedName, 'new york knicks');
	});

	test('rejects structured id-name pairs that conflict with canonical team data', () => {
		const error = validateStructuredTeamSubjectPairs({
			ids: ['1610612738'],
			names: ['Knicks']
		});

		assert.match(error ?? '', /same canonical team/i);
	});

	test('accepts structured id-name pairs that resolve through curated team aliases', () => {
		const error = validateStructuredTeamSubjectPairs({
			ids: ['1610612750'],
			names: ['Wolves']
		});

		assert.equal(error, null);
	});
});
