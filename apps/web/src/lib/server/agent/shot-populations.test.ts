import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
import type { EndpointFetchResult } from '$lib/server/data/adapters/stats-endpoint-client';
import { createDynamicQueryAgent } from './service';
import type { DynamicAgentModelResponse } from './types';

/* Population fixture helpers */

const windows = [
	{ dateFrom: '2024-12-01', dateTo: '2024-12-31' },
	{ dateFrom: '2025-01-01', dateTo: '2025-01-31' }
];
const shots = [
	['0022400001', 7, '20241231', '1630567', 4, 20, 150, 1, 'Mid-Range', 'Pullup Jump Shot', '2PT Field Goal'],
	['0022400001', 8, '20241231', '1630567', 4, -30, 160, 0, 'Mid-Range', 'Pullup Jump Shot', '2PT Field Goal'],
	['0022400002', 9, '20250115', '1630567', 4, 30, 170, 1, 'Mid-Range', 'Pullup Jump Shot', '2PT Field Goal']
];
const headers = ['GAME_ID', 'GAME_EVENT_ID', 'GAME_DATE', 'PLAYER_ID', 'PERIOD', 'LOC_X', 'LOC_Y', 'SHOT_MADE_FLAG', 'SHOT_ZONE_BASIC', 'ACTION_TYPE', 'SHOT_TYPE'];

function aggregateRequest(window?: { dateFrom: string; dateTo: string }, grouped = false) {
	return { endpointId: 'shotchartdetail', params: { PlayerID: '1630567', Season: '2024-25', SeasonType: 'Regular Season', ...(window ? { DateFrom: window.dateFrom, DateTo: window.dateTo } : {}) },
		filters: [{ column: 'SHOT_ZONE_BASIC', op: 'eq', value: 'Mid-Range' }],
		selectColumns: ['LOC_X', 'LOC_Y', 'SHOT_MADE_FLAG', 'ACTION_TYPE', 'SHOT_TYPE'], rowLimit: 500,
		...(grouped ? { groupBy: ['SHOT_MADE_FLAG'] } : {}), aggregations: [{ op: 'count' }, { op: 'sum', column: 'SHOT_MADE_FLAG' }] };
}

function clipRequest(window?: { dateFrom: string; dateTo: string }) {
	return { playerId: '1630567', season: '2024-25', seasonType: 'Regular Season', eventType: 'custom_shot',
		...window, customShot: { result: 'made', zone: 'mid_range' } };
}

function toolTurn(calls: Array<{ name: string; request: unknown }>): DynamicAgentModelResponse {
	return { content: null, toolCalls: calls.map((call, index) => ({ id: `call-${index}`, name: call.name, arguments: JSON.stringify(call.request) })) };
}

function finalTurn(artifacts: QueryAnswerArtifact[]): DynamicAgentModelResponse {
	return { content: JSON.stringify({ answer: 'The requested scoped populations.', warnings: [], artifacts }), toolCalls: [] };
}

function fixtureAgent(turns: DynamicAgentModelResponse[], rows = shots) {
	return createDynamicQueryAgent({
		model: { async complete() { return turns.shift() ?? assert.fail('Unexpected model call'); } },
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
		teamDirectory: { findByNameOrAlias: () => [] },
		endpointFetcher: async ({ endpointId, params }) => {
			const dateFrom = params.DateFrom ? new Date(params.DateFrom).toISOString().slice(0, 10).replaceAll('-', '') : '';
			const dateTo = params.DateTo ? new Date(params.DateTo).toISOString().slice(0, 10).replaceAll('-', '') : '';
			const scoped = rows.filter((row) => (!dateFrom || String(row[2]) >= dateFrom) && (!dateTo || String(row[2]) <= dateTo));
			const payload = endpointId === 'shotchartdetail'
				? { resultSets: [{ name: 'Shot_Chart_Detail', headers, rowSet: scoped }] }
				: { resultSets: { Meta: { videoUrls: scoped.map((row) => ({ murl: `https://videos.nba.com/nba/pbp/media/${String(row[2]).slice(0, 4)}/${String(row[2]).slice(4, 6)}/${String(row[2]).slice(6, 8)}/${row[0]}/${row[1]}/video.mp4` })) },
					playlist: scoped.map((row) => ({ gi: row[0], ei: row[1], y: Number(String(row[2]).slice(0, 4)), m: Number(String(row[2]).slice(4, 6)), d: Number(String(row[2]).slice(6, 8)), dsc: `${row[7] ? '' : 'MISS '}Barnes pull-up` })) } };
			return { endpointId, payload, cacheStatus: 'miss', sourceStatus: 'ok', latencyMs: 1, stale: false, isProvisional: false, parserVersion: 'test' } satisfies EndpointFetchResult;
		}
	});
}

function windowTurns() {
	return [toolTurn(windows.flatMap((window) => [
		{ name: 'aggregate_endpoint_rows', request: aggregateRequest(window) },
		{ name: 'find_video_clips', request: clipRequest(window) }
	])), { content: null, toolCalls: [] }, finalTurn([
		{ type: 'shot_chart', title: 'January shots', shots: [] }, { type: 'shot_chart', title: 'December shots', shots: [] },
		{ type: 'video_playlist', title: 'January clips', clips: [] }, { type: 'video_playlist', title: 'December clips', clips: [] }
	])] satisfies DynamicAgentModelResponse[];
}

/* End population fixture helpers */

test('distinct date windows keep canonical event populations and scope labels despite reversed model artifacts', async () => {
	const response = await fixtureAgent(windowTurns()).answerQuestion('Show shot charts and clips for two date ranges.');
	for (const result of response.toolResults) {
		if ('ok' in result.response) assert.equal(result.response.ok, true, result.response.error);
	}
	const charts = response.artifacts.filter((artifact) => artifact.type === 'shot_chart');
	assert.equal(charts.length, 2, 'Identical aggregate and clip research populations must deduplicate');
	assert.deepEqual(charts.map((chart) => [chart.source?.population?.dateFrom, chart.shots.map((shot) => shot.eventId)]), [['2024-12-01', ['7', '8']], ['2025-01-01', ['9']]]);
	for (const chart of charts) assert.ok(chart.title.includes(String(chart.source?.population?.dateFrom)));
	const playlists = response.artifacts.filter((artifact) => artifact.type === 'video_playlist');
	assert.equal(playlists.length, 2);
	assert.deepEqual(playlists.map((playlist) => [playlist.source?.population?.dateFrom, playlist.clips.map((clip) => clip.eventId)]), [['2024-12-01', ['7']], ['2025-01-01', ['9']]]);
	for (const playlist of playlists) assert.ok(playlist.title.includes(String(playlist.source?.population?.dateFrom)));
});

test('empty date windows retain their own labels and zero clip coverage without duplicating sources', async () => {
	const response = await fixtureAgent(windowTurns(), shots.slice(0, 2)).answerQuestion('Show shot charts and clips for two date ranges.');
	const charts = response.artifacts.filter((artifact) => artifact.type === 'shot_chart');
	assert.deepEqual(charts.map((chart) => [chart.source?.population?.dateFrom, chart.shots.length]), [['2024-12-01', 2], ['2025-01-01', 0]]);
	assert.match(charts[1].title, /2025-01-01 to 2025-01-31/);
	const playlists = response.artifacts.filter((artifact) => artifact.type === 'video_playlist');
	assert.equal(playlists[1].clips.length, 0);
	assert.equal(playlists[1].coverage?.matchingShotEventCount, 0);
});

test('made and missed grouped charts ground separate populations instead of overwriting both with full rows', async () => {
	const response = await fixtureAgent([toolTurn([{ name: 'aggregate_endpoint_rows', request: aggregateRequest(undefined, true) }]),
		{ content: null, toolCalls: [] }, finalTurn([{ type: 'shot_chart', title: 'Misses', shots: [] }, { type: 'shot_chart', title: 'Makes', shots: [] }])
	]).answerQuestion('Show grouped shot charts.');
	const charts = response.artifacts.filter((artifact) => artifact.type === 'shot_chart');
	assert.deepEqual(charts.map((chart) => [chart.source?.population?.result, chart.shots.map((shot) => shot.eventId)]), [['made', ['7', '9']], ['missed', ['8']]]);
	assert.match(charts[0].title, /makes/);
	assert.match(charts[1].title, /misses/);
});

test('season comparison deduplicates empty aggregate and clip populations while surfacing both empty playlists', async () => {
	const artifacts: QueryAnswerArtifact[] = [{ type: 'shot_chart', title: 'Original single-query title', shots: [] }];
	const agent = fixtureAgent([toolTurn([{ name: 'aggregate_endpoint_rows', request: aggregateRequest() }, { name: 'find_video_clips', request: clipRequest() }]),
		{ content: null, toolCalls: [] }, finalTurn(artifacts), finalTurn(artifacts)
	], []);
	const initial = await agent.answerQuestion('Show mid-range FG% and made clips in 2024-25.');
	assert.equal(initial.artifacts.find((artifact) => artifact.type === 'shot_chart')?.title, 'Original single-query title');
	const comparison = await agent.answerQuestion('Compare with 2023-24.', { sessionId: initial.sessionId });
	const charts = comparison.artifacts.filter((artifact) => artifact.type === 'shot_chart');
	assert.deepEqual(charts.map((chart) => [chart.source?.population?.season, chart.shots.length]), [['2024-25', 0], ['2023-24', 0]]);
	const playlists = comparison.artifacts.filter((artifact) => artifact.type === 'video_playlist');
	assert.deepEqual(playlists.map((playlist) => [playlist.source?.population?.season, playlist.clips.length, playlist.coverage?.matchingShotEventCount]), [['2024-25', 0, 0], ['2023-24', 0, 0]]);
});

test('a capped aggregate plot is explicitly sampled and retains its exact selected rows', async () => {
	const response = await fixtureAgent([toolTurn([{ name: 'aggregate_endpoint_rows', request: { ...aggregateRequest(), rowLimit: 1 } }]),
		{ content: null, toolCalls: [] }, finalTurn([{ type: 'shot_chart', title: 'Scoped sample', shots: [] }])
	]).answerQuestion('Show a mid-range shot chart.');
	const chart = response.artifacts.find((artifact) => artifact.type === 'shot_chart');
	if (chart?.type !== 'shot_chart') assert.fail('Missing sampled chart');
	assert.equal(chart.source?.sampled, true);
	assert.deepEqual(chart.shots.map((shot) => shot.eventId), ['7']);
});

test('full same-scope custom research supersedes a capped plot only with provable event containment', async () => {
	const response = await fixtureAgent([toolTurn([
		{ name: 'find_video_clips', request: clipRequest() },
		{ name: 'aggregate_endpoint_rows', request: { ...aggregateRequest(), rowLimit: 1 } }
	]), { content: null, toolCalls: [] }, finalTurn([{ type: 'shot_chart', title: 'Scoped shots', shots: [] }])
	]).answerQuestion('Show mid-range FG% and made clips.');
	const charts = response.artifacts.filter((artifact) => artifact.type === 'shot_chart');
	assert.equal(charts.length, 1);
	assert.equal(charts[0].source?.sampled, false);
	assert.equal(charts[0].source?.toolName, 'find_video_clips');
	assert.deepEqual(charts[0].shots.map((shot) => shot.eventId), ['7', '8', '9']);
});

test('a capped plot with unverifiable identities remains sampled beside full research', async () => {
	const rowsWithoutIds = shots.map((row) => [row[0], row[1], ...row.slice(2)]);
	rowsWithoutIds[0][0] = 'invalid-game-id';
	const response = await fixtureAgent([toolTurn([
		{ name: 'aggregate_endpoint_rows', request: { ...aggregateRequest(), rowLimit: 1 } },
		{ name: 'find_video_clips', request: clipRequest() }
	]), { content: null, toolCalls: [] }, finalTurn([{ type: 'shot_chart', title: 'Scoped shots', shots: [] }])
	], rowsWithoutIds).answerQuestion('Show mid-range FG% and made clips.');
	const charts = response.artifacts.filter((artifact) => artifact.type === 'shot_chart');
	assert.equal(charts.some((chart) => chart.source?.sampled && chart.shots.length === 1), true);
});
