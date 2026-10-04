import assert from 'node:assert/strict';
import { test } from 'node:test';
import playerSnapshot from '$lib/server/players/fixtures/player-directory-snapshot.json';
import teamSnapshot from '$lib/server/teams/fixtures/team-directory-snapshot.json';
import identityIndex from './entity-media-index.json';
import { resolvePlayerEntity, resolveTeamEntity } from './entity-media';

test('decorative identities resolve only exact names or directory IDs, including diacritics', () => {
	assert.equal(resolvePlayerEntity('Nikola Jokić')?.id, '203999');
	assert.equal(resolvePlayerEntity('  nikola JOKIC ')?.id, '203999');
	assert.equal(resolvePlayerEntity({ id: 203999, name: 'Nikola Jokić' })?.name, 'Nikola Jokic');
	assert.equal(resolvePlayerEntity('203999')?.id, '203999');
	assert.equal(resolvePlayerEntity('Scottie Barnes')?.id, '1630567');
	assert.equal(resolvePlayerEntity('Victor Wembanyama')?.id, '1641705');
	assert.equal(resolvePlayerEntity('D’Angelo Russell')?.id, '1626156');
	assert.equal(resolvePlayerEntity('Curry'), null);
	assert.equal(resolvePlayerEntity('Nikola'), null);
	assert.equal(resolvePlayerEntity('A completely unknown player'), null);
	assert.equal(resolvePlayerEntity({ id: '203999', name: 'Joel Embiid' }), null);
	assert.equal(resolvePlayerEntity({ id: '999999999', name: 'Nikola Jokic' }), null);
});

test('team aliases remain grounded and ambiguous city names require a matching ID', () => {
	assert.equal(resolveTeamEntity('Toronto Raptors')?.id, '1610612761');
	assert.equal(resolveTeamEntity('TOR')?.name, 'Toronto Raptors');
	assert.equal(resolveTeamEntity('Raptors')?.id, '1610612761');
	assert.equal(resolveTeamEntity('Los Angeles'), null);
	assert.equal(resolveTeamEntity({ id: '1610612747', name: 'Los Angeles' })?.name, 'Los Angeles Lakers');
	assert.equal(resolveTeamEntity({ id: '1610612747', name: 'Clippers' }), null);
	assert.equal(resolveTeamEntity('SEA'), null);
});

test('generated media stays on fixed NBA CDN paths and has no current roster metadata', () => {
	const player = resolvePlayerEntity('203999')!;
	const team = resolveTeamEntity('TOR')!;
	assert.equal(player.imageUrl, 'https://cdn.nba.com/headshots/nba/latest/260x190/203999.png');
	assert.equal(team.imageUrl, 'https://cdn.nba.com/logos/nba/1610612761/primary/L/logo.svg');
	assert.equal(player.initials, 'NJ');
	assert.equal(team.initials, 'TOR');
	assert.deepEqual(Object.keys(player).sort(), ['id', 'imageUrl', 'initials', 'kind', 'name']);
	assert.equal(resolvePlayerEntity({ id: 'https://evil.example/player.png' }), null);
	assert.equal(resolvePlayerEntity({ id: '../203999' }), null);
	assert.equal(resolveTeamEntity({ id: '../1610612761' }), null);
});

test('compact browser identities stay synchronized with the trusted directory snapshots', () => {
	const regeneration = 'Refresh the compact index with bun ./scripts/generate-entity-media-index.ts after directory updates.';
	assert.deepEqual(identityIndex.players, playerSnapshot.map((player) => [String(player.playerId), `${player.firstName} ${player.lastName}`.trim()]), regeneration);
	assert.deepEqual(identityIndex.teams, teamSnapshot.map((team) => [team.teamId, team.canonicalName, team.abbreviation, team.shortName, team.cityName]), regeneration);
});
