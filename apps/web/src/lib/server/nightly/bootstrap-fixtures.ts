import type { EndpointFetchRequest, EndpointFetchResult } from '$lib/server/data';
import {
	buildDeterministicPlayerSeasonStatsParams,
	findDeterministicFixturePayload
} from './deterministic-fixtures';
import type { NightlyBootstrapFetcher } from './bootstrap-service';

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

function buildTrendFixture(playerId: string, pts: number, ast: number, reb: number): unknown {
	return {
		resource: 'playergamelog',
		resultSets: [
			{
				name: 'PlayerGameLog',
				headers: ['SEASON_ID', 'Player_ID', 'GAME_DATE', 'PTS', 'AST', 'REB'],
				rowSet: [['22025', playerId, 'APR 01, 2026', pts, ast, reb]]
			}
		]
	};
}

function extractPlayerLookupRow(playerId: string): {
	playerId: string;
	playerName: string;
	pts: number;
	ast: number;
	reb: number;
} | null {
	const payload = findDeterministicFixturePayload({
		endpointId: 'leaguedashplayerstats',
		params: buildDeterministicPlayerSeasonStatsParams('2025-26')
	}) as {
		resultSets?: Array<{ headers?: unknown[]; rowSet?: unknown[][] }>;
	} | null;
	const resultSet = payload?.resultSets?.[0];
	if (!resultSet || !Array.isArray(resultSet.headers) || !Array.isArray(resultSet.rowSet)) {
		return null;
	}

	const playerIdIndex = resultSet.headers.indexOf('PLAYER_ID');
	const playerNameIndex = resultSet.headers.indexOf('PLAYER_NAME');
	const ptsIndex = resultSet.headers.indexOf('PTS');
	const astIndex = resultSet.headers.indexOf('AST');
	const rebIndex = resultSet.headers.indexOf('REB');
	const row = resultSet.rowSet.find((candidate) => String(candidate[playerIdIndex] ?? '') === playerId);
	if (!row) {
		return null;
	}

	return {
		playerId,
		playerName: String(row[playerNameIndex] ?? 'Unknown Player'),
		pts: Number(row[ptsIndex] ?? 0),
		ast: Number(row[astIndex] ?? 0),
		reb: Number(row[rebIndex] ?? 0)
	};
}

/* Public fixture API */

/**
 * Provides a deterministic local bootstrap path when live NBA endpoint access is unavailable.
 */
export function createNightlyBootstrapFixtureFetcher(): NightlyBootstrapFetcher {
	return async (request) => {
		const payload = findDeterministicFixturePayload(request);
		if (payload !== null) {
			return buildOkResult(request, payload);
		}

		if (request.endpointId === 'playercareerstats') {
			const row = extractPlayerLookupRow(request.params.PlayerID);
			if (row) {
				return buildOkResult(
					request,
					buildCareerStatsFixture(row.playerId, row.playerName, row.pts, row.ast, row.reb)
				);
			}
		}

		if (request.endpointId === 'playergamelog') {
			const row = extractPlayerLookupRow(request.params.PlayerID);
			if (row) {
				return buildOkResult(request, buildTrendFixture(row.playerId, row.pts, row.ast, row.reb));
			}
		}

		throw new Error(`Unexpected deterministic fixture request '${request.endpointId}'.`);
	};
}
