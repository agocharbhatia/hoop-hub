import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryAnswerArtifact, QueryAnswerResponse } from '$lib/contracts/answer-response';
import { playlistPlayer, researchSubjects } from './research-subjects';

const base: QueryAnswerResponse = { status: 'ok', answer: '', artifacts: [], warnings: [], citations: [], toolResults: [], traceId: 'subjects' };
const scoped: QueryAnswerResponse = { ...base, effectiveScope: { seasons: ['2024-25'], playerIds: ['203999', '1641705'], teamIds: ['1610612743'], opponentTeamIds: ['1610612759'] } };

test('research subjects resolve only explicit scope teams and players', () => {
	const subjects = researchSubjects(scoped);
	assert.deepEqual(subjects.players.map((subject) => subject.entity?.id), ['203999', '1641705']);
	assert.deepEqual(subjects.teams.map((subject) => subject.entity?.id), ['1610612743', '1610612759']);
	assert.equal(subjects.teams[1].role, 'Opponent');
	assert.equal(subjects.matchup, false);
	assert.deepEqual(researchSubjects({ ...base, effectiveScope: { ...scoped.effectiveScope!, teamIds: [], opponentTeamIds: [] } }).teams, []);
});

test('matchup roles require a successful unique request and do not relabel a multi-player trend', () => {
	const matchup = { toolName: 'analyze_player_matchup' as const, request: { offensivePlayerId: '203999', defensivePlayerId: '1641705' }, response: { ok: true } };
	const subjects = researchSubjects({ ...scoped, toolResults: [matchup, matchup] });
	assert.equal(subjects.matchup, true);
	assert.deepEqual(subjects.players.map((subject) => subject.role), ['Offense', 'Defense']);
	assert.equal(researchSubjects({ ...scoped, toolResults: [{ ...matchup, response: { ok: false } }] }).matchup, false);
	assert.equal(researchSubjects({ ...scoped, effectiveScope: { ...scoped.effectiveScope!, playerIds: ['203999', '1641705', '1630567'] }, toolResults: [matchup] }).matchup, false);
});

test('conflicting scope names do not receive another player headshot', () => {
	const subjects = researchSubjects({ ...base, effectiveScope: { seasons: [], playerIds: ['203999'], teamIds: [], opponentTeamIds: [], players: [{ id: '203999', name: 'Scottie Barnes' }] } });
	assert.equal(subjects.players[0].name, 'Scottie Barnes');
	assert.equal(subjects.players[0].entity, null);
});

test('saved canonical matchup rows retain roles without raw tool results', () => {
	const result = { ...scoped, artifacts: [{ type: 'table' as const, shape: 'comparison' as const, columns: ['offensivePlayer', 'defensivePlayer'], rows: [{ offensivePlayer: 'Nikola Jokic', defensivePlayer: 'Victor Wembanyama' }] }] };
	assert.equal(researchSubjects(result).matchup, true);
	assert.deepEqual(researchSubjects(result).players.map((subject) => subject.role), ['Offense', 'Defense']);
	assert.equal(researchSubjects({ ...result, artifacts: [{ ...result.artifacts[0], rows: [{ offensivePlayer: 'Scottie Barnes', defensivePlayer: 'Victor Wembanyama' }] }] }).matchup, false);
});

test('each playlist uses its own source identity, with single-subject fallback for older saved answers', () => {
	const playlist: Extract<QueryAnswerArtifact, { type: 'video_playlist' }> = { type: 'video_playlist', title: 'Clips', clips: [] };
	assert.equal(playlistPlayer(playlist, scoped), null);
	assert.equal(playlistPlayer({ ...playlist, source: { toolName: 'find_video_clips', endpointId: 'videodetailsasset', resultSetName: 'playlist', request: { playerId: '1641705' } } }, scoped)?.id, '1641705');
	assert.equal(playlistPlayer(playlist, { ...scoped, effectiveScope: { ...scoped.effectiveScope!, playerIds: ['203999'] } })?.id, '203999');
	assert.equal(playlistPlayer({ ...playlist, source: { toolName: 'find_video_clips', endpointId: 'videodetailsasset', resultSetName: 'playlist', request: { playerId: '999999999' } } }, scoped), null);
});
