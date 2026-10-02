import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import jokic from '../../../../eval/fixtures/real-nba/nikola-jokic-2024-25-playergamelog.json';
import wembanyama from '../../../../eval/fixtures/real-nba/victor-wembanyama-2024-25-playergamelog.json';
import type { EndpointFetchResult } from '$lib/server/data/adapters/stats-endpoint-client';
import type { StatsQueryRow } from '$lib/contracts/semantic-query';
import { createDynamicQueryAgent } from './service';
import { createQuerySessionStore } from './query-session-store';
import type { DynamicAgentModelResponse } from './types';

/* Independent raw-row oracle and frozen adapter helpers */

const snapshots = [jokic, wembanyama];
function oracle(snapshot: typeof jokic, metric: string) {
	const headers = snapshot.dataset.headers;
	const dateIndex = headers.indexOf('GAME_DATE');
	const metricIndex = headers.indexOf(metric);
	const gameIndex = headers.indexOf('Game_ID');
	assert.ok(dateIndex >= 0 && metricIndex >= 0 && gameIndex >= 0);
	const ordered = snapshot.dataset.rowSet.map((row) => {
		const date = String(row[dateIndex]); const value = Number(row[metricIndex]);
		assert.ok(Number.isFinite(Date.parse(date)) && Number.isFinite(value));
		return { date, value, gameId: String(row[gameIndex]) };
	}).sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
	const latest = ordered.slice(ordered.length - 10);
	assert.equal(new Set(latest.map((row) => row.gameId)).size, 10);
	const earlierAverage = latest.slice(0, 5).reduce((sum, row) => sum + row.value, 0) / 5;
	const recentAverage = latest.slice(5).reduce((sum, row) => sum + row.value, 0) / 5;
	return { points: latest.map((row) => ({ x: row.date, y: row.value })), earlierAverage, recentAverage,
		change: recentAverage - earlierAverage, direction: recentAverage > earlierAverage ? 'up' : recentAverage < earlierAverage ? 'down' : 'flat' };
}

function analysis(snapshot: typeof jokic, metric: string): DynamicAgentModelResponse['toolCalls'][number] {
	return { id: `trend-${snapshot.subject.playerId}-${metric}`, name: 'analyze_time_series', arguments: JSON.stringify({ ...snapshot.request, resultSetName: snapshot.dataset.name, dateColumn: 'GAME_DATE', valueColumn: metric, lastN: 10 }) };
}

function frozenResult(snapshot: typeof jokic): EndpointFetchResult {
	return { endpointId: snapshot.request.endpointId, payload: { resultSets: [structuredClone(snapshot.dataset)] }, cacheStatus: snapshot.source.cacheStatus as EndpointFetchResult['cacheStatus'],
		sourceStatus: snapshot.source.sourceStatus as EndpointFetchResult['sourceStatus'], latencyMs: 0, stale: snapshot.source.stale, isProvisional: snapshot.source.isProvisional, parserVersion: snapshot.source.parserVersion };
}

/* End independent raw-row oracle and frozen adapter helpers */

test('real NBA gold snapshots retain complete historical rows, hashes, player identity, and capture provenance', () => {
	assert.deepEqual(snapshots.map((snapshot) => snapshot.rowCount), [70, 46]);
	for (const snapshot of snapshots) {
		assert.equal(snapshot.rowCount, snapshot.dataset.rowSet.length);
		assert.equal(createHash('sha256').update(JSON.stringify(snapshot.dataset)).digest('hex'), snapshot.sha256);
		assert.ok(Number.isFinite(Date.parse(snapshot.capturedAt)));
		assert.equal(new URL(snapshot.source.url).hostname, 'stats.nba.com');
		assert.equal(snapshot.request.params.Season, '2024-25');
		assert.equal(snapshot.request.params.SeasonType, 'Regular Season');
		assert.equal(snapshot.source.cacheRecord?.fetchedAt.slice(0, 10), snapshot.capturedAt.slice(0, 10));
		assert.match(snapshot.source.cacheRecord?.checksum ?? '', /^[a-f0-9]{64}$/);
		const playerIndex = snapshot.dataset.headers.indexOf('Player_ID');
		assert.equal(snapshot.dataset.rowSet.every((row) => String(row[playerIndex]) === snapshot.subject.playerId), true);
	}
});

test('canonical mixed-player mixed-metric trends match an independent latest-ten raw-row oracle', async () => {
	const expected = [{ snapshot: jokic, metric: 'REB', label: 'Rebounds', subject: 'Nikola Jokic', value: oracle(jokic, 'REB') },
		{ snapshot: wembanyama, metric: 'BLK', label: 'Blocks', subject: 'Victor Wembanyama', value: oracle(wembanyama, 'BLK') }];
	const turns: DynamicAgentModelResponse[] = [
		{ content: null, toolCalls: [analysis(jokic, 'REB'), analysis(wembanyama, 'BLK')] },
		{ content: null, toolCalls: [] },
		{ content: JSON.stringify({ answer: 'Invented trend: 999 rebounds and 999 blocks.', warnings: [], artifacts: [
			{ type: 'line_chart', title: 'Wrong mixed-player chart', xLabel: 'Game', yLabel: 'Blocks', series: [{ name: 'Nikola Jokic', points: [{ x: 'invented', y: 999 }] }] },
			{ type: 'table', shape: 'comparison', columns: ['subject', 'earlierAverage'], rows: [['Wrong player', 999]] }
		] }), toolCalls: [] }
	];
	let fetches = 0;
	const agent = createDynamicQueryAgent({
		model: { async complete() { return turns.shift() ?? assert.fail('Unexpected scripted model call'); } },
		endpointFetcher: async (request) => {
			fetches++;
			const snapshot = snapshots.find((entry) => entry.subject.playerId === request.params.PlayerID);
			assert.ok(snapshot, 'Only independently captured player populations are available');
			assert.equal(request.endpointId, 'playergamelog'); assert.equal(request.params.Season, '2024-25'); assert.equal(request.params.SeasonType, 'Regular Season');
			return frozenResult(snapshot);
		},
		playerDirectory: { ensureAvailable: () => ({ ok: true }), findByNameOrAlias: () => [] },
		teamDirectory: { findByNameOrAlias: () => [] }, sessionStore: createQuerySessionStore(), now: () => new Date(jokic.capturedAt)
	});
	const response = await agent.answerQuestion('Compare Nikola Jokic rebounds and Victor Wembanyama blocks over their latest ten recorded games in the 2024-25 regular season. Show charts and the earlier-five versus later-five averages.');
	assert.equal(response.status, 'ok'); assert.equal(fetches, 2);
	const charts = response.artifacts.filter((artifact) => artifact.type === 'line_chart');
	assert.equal(charts.length, 2);
	const table = response.artifacts.find((artifact) => artifact.type === 'table');
	if (table?.type !== 'table') assert.fail('Missing canonical comparison table');
	assert.equal(table.rows.length, 2);
	for (const entry of expected) {
		const chart = charts.find((artifact) => artifact.yLabel === entry.label);
		assert.ok(chart); assert.equal(chart.series.length, 1); assert.ok(chart.series[0].name.includes(entry.subject));
		assert.deepEqual(chart.series[0].points, entry.value.points);
		const comparisonRow: StatsQueryRow | undefined = table.rows.find((candidate) => candidate.subject === entry.subject && candidate.metric === entry.label);
		assert.ok(comparisonRow); assert.equal(comparisonRow.games, 10); assert.equal(comparisonRow.earlierGames, 5); assert.equal(comparisonRow.recentGames, 5);
		assert.equal(comparisonRow.earlierAverage, entry.value.earlierAverage); assert.equal(comparisonRow.recentAverage, entry.value.recentAverage);
		assert.equal(comparisonRow.change, entry.value.change); assert.equal(comparisonRow.direction, entry.value.direction);
		assert.ok(response.answer.includes(entry.subject)); assert.ok(response.answer.includes(String(entry.value.earlierAverage))); assert.ok(response.answer.includes(String(entry.value.recentAverage)));
	}
	assert.doesNotMatch(response.answer, /999|invented/i);
	assert.notEqual(expected[0].value.points.at(-1)?.x, expected[1].value.points.at(-1)?.x, 'Latest windows are per player, not borrowed from the other series');
});
