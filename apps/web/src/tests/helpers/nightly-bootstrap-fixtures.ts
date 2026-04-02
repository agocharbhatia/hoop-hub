import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { EndpointFetchRequest, EndpointFetchResult } from '$lib/server/data';
import type { NightlyBootstrapFetcher } from '$lib/server/nightly/bootstrap-service';

const PLAYER_STATS_FIXTURE = JSON.parse(
	readFileSync(new URL('../../lib/server/semantic/fixtures/leaguedashplayerstats.json', import.meta.url), 'utf8')
) as unknown;
const TEAM_STATS_FIXTURE = JSON.parse(
	readFileSync(new URL('../../lib/server/semantic/fixtures/leaguedashteamstats.json', import.meta.url), 'utf8')
) as unknown;
const CURRY_CAREER_FIXTURE = JSON.parse(
	readFileSync(new URL('../../lib/server/semantic/fixtures/playercareerstats-curry.json', import.meta.url), 'utf8')
) as unknown;
const ACHIUWA_CAREER_FIXTURE = JSON.parse(
	readFileSync(new URL('../../lib/server/semantic/fixtures/playercareerstats-achiuwa.json', import.meta.url), 'utf8')
) as unknown;
const JOKIC_TREND_FIXTURE = JSON.parse(
	readFileSync(new URL('../../lib/server/semantic/fixtures/playergamelog-jokic.json', import.meta.url), 'utf8')
) as unknown;
const ACHIUWA_TREND_FIXTURE = JSON.parse(
	readFileSync(new URL('../../lib/server/semantic/fixtures/playergamelog-achiuwa.json', import.meta.url), 'utf8')
) as unknown;

/* Helper functions */

function buildOkResult(request: EndpointFetchRequest, payload: unknown): EndpointFetchResult {
	return {
		endpointId: request.endpointId,
		payload,
		cacheStatus: 'miss',
		sourceStatus: 'ok',
		latencyMs: 25,
		stale: false,
		isProvisional: true,
		parserVersion: 'v1'
	};
}

function buildCareerStatsFixture(playerId: string, playerName: string, pts: number, ast: number, reb: number): unknown {
	return {
		resource: 'playercareerstats',
		resultSets: [
			{
				name: 'SeasonTotalsRegularSeason',
				headers: ['SEASON_ID', 'PLAYER_ID', 'PLAYER_NAME', 'TEAM_ABBREVIATION', 'PTS', 'AST', 'REB'],
				rowSet: [['2023-24', playerId, playerName, 'TST', pts, ast, reb]]
			}
		]
	};
}

function buildCareerPayloadByPlayerId(playerStatsPayload: unknown): Map<string, unknown> {
	const payload = playerStatsPayload as {
		resultSets?: Array<{ headers?: unknown[]; rowSet?: unknown[][] }>;
	};
	const resultSet = payload.resultSets?.[0];
	if (!resultSet || !Array.isArray(resultSet.headers) || !Array.isArray(resultSet.rowSet)) {
		throw new Error('Expected a readable LeagueDashPlayerStats fixture.');
	}

	const playerIdIndex = resultSet.headers.indexOf('PLAYER_ID');
	const playerNameIndex = resultSet.headers.indexOf('PLAYER_NAME');
	const ptsIndex = resultSet.headers.indexOf('PTS');
	const astIndex = resultSet.headers.indexOf('AST');
	const rebIndex = resultSet.headers.indexOf('REB');
	const payloadByPlayerId = new Map<string, unknown>();

	for (const row of resultSet.rowSet) {
		const playerId = String(row[playerIdIndex] ?? '');
		if (!playerId || payloadByPlayerId.has(playerId)) {
			continue;
		}

		payloadByPlayerId.set(
			playerId,
			buildCareerStatsFixture(
				playerId,
				String(row[playerNameIndex] ?? 'Unknown Player'),
				Number(row[ptsIndex] ?? 0),
				Number(row[astIndex] ?? 0),
				Number(row[rebIndex] ?? 0)
			)
		);
	}

	payloadByPlayerId.set('201939', CURRY_CAREER_FIXTURE);
	payloadByPlayerId.set('1630173', ACHIUWA_CAREER_FIXTURE);
	return payloadByPlayerId;
}

function buildTrendPayloadByPlayerId(playerStatsPayload: unknown): Map<string, unknown> {
	const payload = playerStatsPayload as {
		resultSets?: Array<{ headers?: unknown[]; rowSet?: unknown[][] }>;
	};
	const resultSet = payload.resultSets?.[0];
	if (!resultSet || !Array.isArray(resultSet.headers) || !Array.isArray(resultSet.rowSet)) {
		throw new Error('Expected a readable LeagueDashPlayerStats fixture.');
	}

	const playerIdIndex = resultSet.headers.indexOf('PLAYER_ID');
	const payloadByPlayerId = new Map<string, unknown>();

	for (const row of resultSet.rowSet) {
		const playerId = String(row[playerIdIndex] ?? '');
		if (!playerId || payloadByPlayerId.has(playerId)) {
			continue;
		}

		payloadByPlayerId.set(
			playerId,
			playerId === '203999'
				? JOKIC_TREND_FIXTURE
				: playerId === '1630173'
					? ACHIUWA_TREND_FIXTURE
					: {
							resource: 'playergamelog',
							resultSets: [
								{
									name: 'PlayerGameLog',
									headers: ['SEASON_ID', 'Player_ID', 'GAME_DATE', 'PTS', 'AST', 'REB'],
									rowSet: [['22025', playerId, 'APR 01, 2026', 10, 5, 4]]
								}
							]
						}
		);
	}

	payloadByPlayerId.set('1630173', ACHIUWA_TREND_FIXTURE);
	return payloadByPlayerId;
}

export function createNightlyBootstrapFixtureFetcher(): NightlyBootstrapFetcher {
	const careerPayloadByPlayerId = buildCareerPayloadByPlayerId(PLAYER_STATS_FIXTURE);
	const trendPayloadByPlayerId = buildTrendPayloadByPlayerId(PLAYER_STATS_FIXTURE);

	return async (request) => {
		if (request.endpointId === 'leaguedashplayerstats') {
			return buildOkResult(request, PLAYER_STATS_FIXTURE);
		}

		if (request.endpointId === 'leaguedashteamstats') {
			return buildOkResult(request, TEAM_STATS_FIXTURE);
		}

		if (request.endpointId === 'playercareerstats') {
			const payload = careerPayloadByPlayerId.get(request.params.PlayerID);
			assert.notEqual(payload, undefined);
			return buildOkResult(request, payload);
		}

		if (request.endpointId === 'playergamelog') {
			const payload = trendPayloadByPlayerId.get(request.params.PlayerID);
			assert.notEqual(payload, undefined);
			return buildOkResult(request, payload);
		}

		assert.fail(`Unexpected endpoint '${request.endpointId}'.`);
	};
}
