import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveLatestStartedNbaSeason } from './season-intent';
import { resolveCurrentNbaSeason } from './data/catalog/endpoint-catalog';
import { resolveSeasonForSlateDate } from './nightly/current-season';
import { createDynamicQueryAgent } from './agent/service';
import { createQuerySessionStore } from './agent/query-session-store';
import type { DynamicAgentModelResponse } from './agent/types';

for (const [date, expected] of [
	['2026-07-01T12:00:00Z', '2025-26'], ['2026-10-02T12:00:00Z', '2025-26'],
	['2026-10-20T18:59:59Z', '2025-26'], ['2026-10-20T19:00:00Z', '2026-27'],
	['2025-10-21T23:29:59Z', '2024-25'], ['2025-10-21T23:30:00Z', '2025-26']
]) test(`implicit season uses the latest published regular-season start at ${date}`, () => {
	assert.equal(resolveLatestStartedNbaSeason(new Date(date)), expected);
	assert.equal(resolveCurrentNbaSeason(new Date(date)), expected);
});

test('unknown future openings retain verified evidence, while supplied schedule evidence can advance it', () => {
	assert.equal(resolveLatestStartedNbaSeason(new Date('2027-10-30T00:00:00Z')), '2026-27');
	assert.equal(resolveLatestStartedNbaSeason(new Date('2027-10-30T00:00:00Z'), [
		{ season: '2027-28', startsAtUtc: '2027-10-27T23:00:00Z', sourceUrl: 'https://www.nba.com/verified-test-schedule' }
	]), '2027-28');
	assert.throws(() => resolveLatestStartedNbaSeason(new Date('invalid')), /valid reference date/);
});

test('nightly season defaults share the opening-date evidence during preseason', () => {
	assert.equal(resolveSeasonForSlateDate('2026-10-02'), '2025-26');
	assert.equal(resolveSeasonForSlateDate('2026-10-20'), '2026-27');
	assert.equal(resolveSeasonForSlateDate('2026-10-21'), '2026-27');
	assert.throws(() => resolveSeasonForSlateDate('2026-02-30'), /Invalid slate date/);
});

for (const [question, modelSeason, expected] of [
	['Show Nikola Jokic rebounds this season.', '', '2025-26'],
	['Show Nikola Jokic rebounds in 2026-27.', '2026-27', '2026-27']
]) test(`agent preserves explicit season and corrects implicit preseason intent: ${question}`, async () => {
	const turns: DynamicAgentModelResponse[] = [
		{ content: null, toolCalls: [{ id: 'source', name: 'call_nba_stats_endpoint', arguments: JSON.stringify({ endpointId: 'playergamelogs', params: { PlayerID: '203999', Season: modelSeason, SeasonType: 'Regular Season' } }) }] },
		{ content: null, toolCalls: [] }, { content: JSON.stringify({ answer: 'Recorded games.', artifacts: [], warnings: [] }), toolCalls: [] }
	];
	const seasons: string[] = [];
	const agent = createDynamicQueryAgent({ model: { async complete() { return turns.shift() ?? assert.fail('Unexpected model call'); } }, now: () => new Date('2026-10-02T12:00:00Z'), sessionStore: createQuerySessionStore(), endpointFetcher: async (request) => {
		seasons.push(request.params.Season);
		return { endpointId: request.endpointId, payload: { resultSets: [{ name: 'PlayerGameLogs', headers: ['GAME_DATE', 'REB'], rowSet: [['2026-04-15', 12]] }] }, cacheStatus: 'miss', sourceStatus: 'ok', latencyMs: 1, stale: false, isProvisional: false, parserVersion: 'test' };
	}, playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] }, teamDirectory: { findByNameOrAlias: () => [] } });
	await agent.answerQuestion(question);
	assert.deepEqual(seasons, [expected]);
});
