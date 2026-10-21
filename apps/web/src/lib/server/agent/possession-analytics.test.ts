import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDynamicQueryAgent } from './service';
import { createQuerySessionStore } from './query-session-store';
import { getQueryTraceById } from '$lib/server/semantic/trace-store';
import type { ProviderFetchResult } from '$lib/server/data/providers/client';
import type { QueryAnswerAgentToolResult } from '$lib/contracts/answer-response';
import { buildPossessionAnswer, buildPossessionArtifacts, verifiedPossessionData, findPossessionScopeConflict, parsePossessionAnalytics, validatePossessionAnalyticsRequest, type PossessionAnalyticsRequest } from './possession-analytics';

/* Test helpers */

const base = { mode: 'on_off', teamId: '1610612761', playerIds: ['1630567'], season: '2025-26', seasonType: 'Regular Season' };
function request(extra: Record<string, unknown> = {}): PossessionAnalyticsRequest {
	const parsed = validatePossessionAnalyticsRequest({ ...base, ...extra });
	if (!parsed.ok) throw new Error(parsed.error);
	return parsed.request;
}
function source(datasetId: string, payload: unknown): ProviderFetchResult {
	return { providerId: 'pbpstats', datasetId, endpointId: `pbpstats:${datasetId}`, payload, cacheStatus: 'hit', sourceStatus: 'ok', stale: false, latencyMs: 0, isProvisional: false, parserVersion: 'v1', fetchedAt: '2026-10-02T12:00:00Z', sourceUrl: 'https://pbpstats.com' };
}
const factors = { minutes_on: 2614, minutes_off: 1246, offense_results: [{ stat: 'eFG%', On: 0.5446830265848671, Off: 0.5369292748433303 }], defense_results: [{ stat: 'eFG%', On: 0.5367772108843537, Off: 0.5410058903488899 }] };
const onOff = { results: [{ Stat: 'Pts per 100 Possessions', On: '117.259', Off: '113.651', 'On-Off': '999' }, { Stat: 'Pts per 100 Possessions - Defense', On: '112.819', Off: '111.924' }] };
function lineup(id: number, points: number, offPoss = 200, defPoss = 200) {
	return { EntityId: `1630567-${id}-2-3-4`, TeamId: '1610612761', Name: `Lineup ${id}`, OffPoss: offPoss, DefPoss: defPoss, Points: points, OpponentPoints: 200, GamesPlayed: 10, Minutes: 100 };
}

/* End test helpers */

test('on/off uses provider units, independent denominators and computed differences rather than its formatted delta', () => {
	const data = parsePossessionAnalytics(request(), [source('on_off', onOff), source('four_factors', factors)]);
	const offense = data.rows.find((row) => row.metric === 'Offensive rating')!;
	assert.equal(offense.on, 117.259);
	assert.ok(Math.abs(Number(offense.difference) - 3.608) < 1e-9);
	const net = data.rows.find((row) => row.metric === 'Net rating')!;
	assert.ok(Math.abs(Number(net.on) - 4.44) < 1e-9);
	assert.ok(Math.abs(Number(net.off) - 1.727) < 1e-9);
	const efg = data.rows.find((row) => row.metric === 'Offense · Effective FG%')!;
	assert.ok(Math.abs(Number(efg.on) - 54.46830265848671) < 1e-9);
	assert.equal(efg.minutesOn, 2614);
});

test('lineups rank after full filtering, including a winner beyond the model row sample and tiny-sample exclusion', () => {
	const rows = Array.from({ length: 170 }, (_, index) => lineup(index + 10, 200 + index));
	rows.push(lineup(999, 800, 1, 1), lineup(1000, 600));
	const data = parsePossessionAnalytics(request({ mode: 'lineups', playerIds: [], limit: 2, minPossessions: 100 }), [source('lineups', { multi_row_table_data: rows })]);
	assert.deepEqual(data.rows.map((row) => row.lineup), ['Lineup 1000', 'Lineup 179']);
	assert.equal(data.rows[0].offensiveRating, 300);
	assert.equal(data.rows[0].defensiveRating, 100);
	assert.equal(data.rows[0].netRating, 200);
	assert.equal(data.coverage.qualifyingRows, 171);
});

test('lineup player filters use exact NBA identities and defense ranking requires a meaningful defensive sample', () => {
	const first = lineup(10, 200), second = lineup(11, 250), third = lineup(12, 300, 200, 2);
	const data = parsePossessionAnalytics(request({ mode: 'lineups', playerIds: ['10'], metric: 'defensiveRating', minPossessions: 100 }), [source('lineups', { multi_row_table_data: [first, second, third] })]);
	assert.equal(data.rows.length, 1);
	assert.equal(data.rows[0].lineup, 'Lineup 10');
	assert.throws(() => parsePossessionAnalytics(request({ mode: 'lineups' }), [source('lineups', { multi_row_table_data: [{ ...first, TeamId: '1610612738' }] })]), /different team/);
});

test('upstream lineup caps, stale snapshots and missing numeric values remain explicit', () => {
	const data = parsePossessionAnalytics(request({ mode: 'lineups', playerIds: [] }), [{ ...source('lineups', { multi_row_table_data: Array.from({ length: 500 }, (_, id) => lineup(id + 10, 200)) }), stale: true }]);
	assert.equal(data.coverage.possibleProviderCap, true);
	assert.ok(data.warnings.some((warning) => warning.code === 'pbpstats_lineups_sampled'));
	assert.ok(data.warnings.some((warning) => warning.code === 'pbpstats_stale'));
	const missing = parsePossessionAnalytics(request(), [source('on_off', { results: [{ Stat: 'Pts per 100 Possessions', On: null, Off: '113' }] }), source('four_factors', factors)]);
	assert.equal(missing.rows[0].on, null);
	assert.equal(missing.rows[0].difference, null);
});

test('sparse sub-minute lineups use seconds and equivalent on/off metric requests share one canonical scope', () => {
	const sparse = { ...lineup(10, 200, 2, 2), Minutes: undefined, SecondsPlayed: 30 };
	const data = parsePossessionAnalytics(request({ mode: 'lineups', playerIds: [], minPossessions: 0 }), [source('lineups', { multi_row_table_data: [sparse] })]);
	assert.equal(data.rows[0].minutes, 0.5);
	const excluded = parsePossessionAnalytics(request({ mode: 'lineups', playerIds: [] }), [source('lineups', { multi_row_table_data: [sparse] })]);
	assert.equal(excluded.rows.length, 0);
	assert.deepEqual(request({ metric: 'offensiveRating', limit: 1 }), request({ metric: 'defensiveRating', direction: 'asc' }));
});

test('combination state counts, minute thresholds and unavailable ratings cannot imply complete tiny-sample rankings', () => {
	const data = parsePossessionAnalytics(request({ mode: 'combinations', playerIds: ['1', '2'], minMinutes: 100 }), [source('combinations', { results: [
		{ On: 'A, B', Off: '', Minutes: 5, OffRtg: 200, DefRtg: 10, NetRtg: 190 },
		{ On: 'A', Off: 'B', Minutes: 500, OffRtg: 110, DefRtg: 100, NetRtg: 10 },
		{ On: '', Off: 'A, B', Minutes: 100, OffRtg: null, DefRtg: null, NetRtg: null }
	] })]);
	assert.equal(data.rows.length, 2);
	assert.equal(data.rows[0].playersOn, 'A');
	assert.equal(data.rows[1].netRating, null);
	assert.ok(data.warnings.some((warning) => warning.code === 'pbpstats_combinations_partial'));
});

test('possession-start units and missing values are preserved without guessing counts or summing overlapping groups', () => {
	const data = parsePossessionAnalytics(request({ mode: 'possession_starts', playerIds: [] }), [source('possession_starts', { results: [{ team_id: '1610612761', ppp: 1.2, spp: 14, ppp_off_steal: 1.4, spp_off_steal: 8 }] })]);
	assert.equal(data.rows.find((row) => row.start === 'After steal')?.offensiveRating, 140);
	assert.equal(data.rows.find((row) => row.start === 'After timeout')?.offensiveRating, null);
	assert.ok(data.warnings.some((warning) => warning.code === 'pbpstats_start_context'));
});

test('unrepresentable scopes cannot silently broaden through the provider tool', () => {
	for (const extra of [{ opponentTeamId: '1610612738' }, { mode: 'on_off', playerIds: ['1', '2'] }, { mode: 'possession_starts', playerIds: ['1'] }, { minPossessions: 100 }, { dateFrom: '2026-02-31' }, { mode: 'combinations', metric: 'possessions' }]) {
		assert.equal(validatePossessionAnalyticsRequest({ ...base, ...extra }).ok, false);
	}
	assert.match(findPossessionScopeConflict('Rank fourth quarter lineups.', request({ mode: 'lineups', playerIds: [] }))!, /quarter/);
	assert.match(findPossessionScopeConflict('Show on/off over the last ten games.', request())!, /last-N/);
	assert.match(findPossessionScopeConflict('Top 5 lineups with at least 1000 possessions.', request({ mode: 'lineups', playerIds: [], limit: 5, minPossessions: 100 }))!, /1000/);
});

test('agent replaces fabricated provider prose/artifacts, streams canonical evidence, saves scope and compares seasons', async () => {
	let modelCalls = 0;
	const retrieved: string[] = [];
	const progressive: unknown[] = [];
	const sessions = createQuerySessionStore();
	const agent = createDynamicQueryAgent({
		model: { async complete() {
			modelCalls += 1;
			if (modelCalls === 1) return { content: null, toolCalls: [{ id: 'pbp', name: 'analyze_possession_stats', arguments: JSON.stringify(base) }] };
			return { content: JSON.stringify({ answer: 'Invented causal impact of 999 points.', artifacts: [{ type: 'table', shape: 'comparison', columns: ['fake'], rows: [[999]] }, { type: 'bar_chart', title: 'fake', xLabel: 'fake', yLabel: 'fake', bars: [{ label: 'fake', value: 999 }] }], warnings: [] }), toolCalls: [] };
		} },
		endpointFetcher: async () => { throw new Error('Wrong provider'); },
		providerFetcher: async (r) => { retrieved.push(`${r.datasetId}:${r.params.Season}`); return source(r.datasetId, r.datasetId === 'on_off' ? onOff : factors); },
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
		teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: sessions
	});
	const answer = await agent.answerQuestion('Compare Toronto on/off with Scottie Barnes in 2025-26.', { onArtifacts: (artifacts) => progressive.push(artifacts) });
	assert.equal(answer.status, 'ok');
	assert.doesNotMatch(answer.answer, /999|causal impact/);
	assert.match(answer.answer, /higher net rating/);
	assert.doesNotMatch(answer.answer, /117\.26|4\.44|2614/);
	assert.equal(answer.artifacts[0].type === 'table' && answer.artifacts[0].rows.find((row) => row.metric === 'Offensive rating')?.on, 117.259);
	assert.equal(answer.citations.length, 1);
	assert.equal(answer.citations[0].source, 'pbpstats.com');
	assert.equal(answer.effectiveScope?.teamIds[0], '1610612761');
	assert.equal(answer.effectiveScope?.playerIds[0], '1630567');
	assert.ok(progressive.length > 0);
	assert.equal(answer.artifacts.length, 2);
	assert.equal(answer.artifacts[0].type === 'table' && answer.artifacts[0].source?.providerId, 'pbpstats');
	assert.ok(answer.warnings.some((warning) => warning.code === 'pbpstats_descriptive_on_off'));
	const trace = getQueryTraceById(answer.traceId);
	assert.ok(trace?.sourceCalls.every((call) => call.endpointId.startsWith('pbpstats:')));
	const compared = await agent.answerQuestion('Compare with 2024-25.', { sessionId: answer.sessionId });
	assert.deepEqual(new Set(compared.effectiveScope?.seasons), new Set(['2025-26', '2024-25']));
	assert.equal(compared.artifacts.filter((artifact) => artifact.type === 'table').length, 2);
	assert.ok(retrieved.includes('on_off:2024-25'));
});

test('source-owned lineup coverage warnings suppress duplicate model phrasing', async () => {
	let calls = 0;
	const agent = createDynamicQueryAgent({
		model: { async complete() {
			if (++calls === 1) return { content: null, toolCalls: [{ id: 'lineups', name: 'analyze_possession_stats', arguments: JSON.stringify({ ...base, mode: 'lineups', playerIds: [], limit: 5 }) }] };
			return { content: JSON.stringify({ answer: '', artifacts: [], warnings: [{ kind: 'partial_data', message: 'The provider may have capped the lineup population; rankings are not verified against every lineup.' }] }), toolCalls: [] };
		} },
		endpointFetcher: async () => { throw new Error('Wrong provider'); },
		providerFetcher: async () => source('lineups', { multi_row_table_data: Array.from({ length: 500 }, (_, id) => lineup(id + 10, 200)) }),
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
		teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore()
	});
	const answer = await agent.answerQuestion('Top 5 Toronto lineups in 2025-26.');
	assert.deepEqual(answer.warnings.map((warning) => warning.code), ['pbpstats_lineups_sampled']);
});


test('legacy on/off metric variants share one canonical population and one takeaway', () => {
	const data = parsePossessionAnalytics(request(), [source('on_off', onOff), source('four_factors', factors)]);
	const results = ['offensiveRating', 'defensiveRating', 'netRating'].map((metric) => ({
		toolName: 'analyze_possession_stats', request: { ...data.request, metric },
		response: { ok: true, data: { ...data, request: { ...data.request, metric } } }
	})) as QueryAnswerAgentToolResult[];
	assert.equal(verifiedPossessionData(results).length, 1);
	assert.equal(buildPossessionArtifacts(results).length, 2);
	const summary = buildPossessionAnswer(results);
	assert.equal(summary.split('\n\n').length, 1);
	assert.match(summary, /higher net rating/);
	assert.doesNotMatch(summary, /117\.26|4\.44|2614/);
	const anotherSeason = { ...data, request: { ...data.request, season: '2024-25' } };
	results.push({ toolName: 'analyze_possession_stats', request: anotherSeason.request, response: { ok: true, data: anotherSeason } } as unknown as QueryAnswerAgentToolResult);
	assert.equal(verifiedPossessionData(results).length, 2, 'different seasons must remain separate');
});

test('temporary provider failures carry recovery intent through the agent response', async () => {
	let calls = 0;
	const agent = createDynamicQueryAgent({
		model: { async complete() {
			if (++calls === 1) return { content: null, toolCalls: [{ id: 'pbp', name: 'analyze_possession_stats', arguments: JSON.stringify({ ...base, mode: 'lineups', playerIds: [], limit: 5, minPossessions: 100 }) }] };
			return { content: JSON.stringify({ answer: 'The lineup data could not be retrieved.', artifacts: [], warnings: [{ kind: 'partial_data', message: 'Lineup data unavailable.' }] }), toolCalls: [] };
		} },
		providerFetcher: async () => ({ ...source('lineups', null), cacheStatus: 'miss', sourceStatus: 'timeout', retryable: true, errorDetail: 'PBP Stats retrieval timed out.' }),
		endpointFetcher: async () => { throw new Error('Wrong provider'); },
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
		teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore()
	});
	const answer = await agent.answerQuestion('Rank Toronto’s top five lineups by net rating in 2025–26, with at least 100 offensive and defensive possessions.');
	assert.equal(answer.status, 'coverage_gap');
	assert.equal(answer.recovery?.kind, 'temporary_source_failure');
	assert.equal(answer.artifacts.length, 0);
});
