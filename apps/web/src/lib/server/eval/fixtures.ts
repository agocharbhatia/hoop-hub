import type { EndpointFetchResult, StatsEndpointFetcher } from '$lib/server/data/adapters/stats-endpoint-client';
import type { EvalFixtureId } from './types';

type FixtureDefinition = {
	endpointId: string | null;
	payload: unknown | null;
};

const JOKIC_REBOUNDS_NEWEST_FIRST = [8, 16, 14, 8, 17, 15, 15, 21, 17, 14];
const JOKIC_DATES_NEWEST_FIRST = [
	'2026-04-12',
	'2026-04-08',
	'2026-04-06',
	'2026-04-04',
	'2026-04-01',
	'2026-03-29',
	'2026-03-27',
	'2026-03-25',
	'2026-03-24',
	'2026-03-22'
];

const FIXTURES: Record<EvalFixtureId, FixtureDefinition> = {
	scottie_pullup_midrange: {
		endpointId: 'shotchartdetail',
		payload: buildScottieShotChartPayload()
	},
	jokic_rebound_trend: {
		endpointId: 'playergamelogs',
		payload: {
			resultSets: [
				{
					name: 'PlayerGameLogs',
					headers: ['GAME_DATE', 'MATCHUP', 'REB'],
					rowSet: JOKIC_DATES_NEWEST_FIRST.map((date, index) => [
						date,
						`DEN game ${index + 1}`,
						JOKIC_REBOUNDS_NEWEST_FIRST[index]
					])
				}
			]
		}
	},
	top_five_assists: {
		endpointId: 'leaguedashplayerstats',
		payload: buildTopAssistsPayload()
	},
	scottie_made_threes_boston: {
		endpointId: 'videodetailsasset',
		payload: {
			resultSets: {
				Meta: {
					videoUrls: [
						{ murl: 'https://videos.nba.com/eval-layup.mp4' },
						{ murl: 'https://videos.nba.com/eval-three-1.mp4' },
						{ murl: 'https://videos.nba.com/eval-three-2.mp4' }
					]
				},
				playlist: [
					{ gi: 'eval-1', ei: '1', y: 2026, m: 1, d: 5, dsc: 'Barnes driving layup' },
					{ gi: 'eval-2', ei: '2', y: 2026, m: 1, d: 8, dsc: "Barnes 26' 3PT Running Jump Shot" },
					{ gi: 'eval-3', ei: '3', y: 2026, m: 2, d: 2, dsc: "Barnes 24' 3PT Pullup Jump Shot" }
				]
			}
		}
	},
	named_defender: {
		endpointId: null,
		payload: null
	}
};

/**
 * Supplies stable NBA endpoint payloads so local evals exercise the real tool path without network drift.
 */
export function createEvalFixtureFetcher(fixtureId: EvalFixtureId): StatsEndpointFetcher {
	const fixture = FIXTURES[fixtureId];
	return async (request): Promise<EndpointFetchResult> => {
		if (!fixture.endpointId) {
			throw new Error(`Eval fixture '${fixtureId}' forbids endpoint calls.`);
		}
		if (request.endpointId !== fixture.endpointId) {
			throw new Error(
				`Eval fixture '${fixtureId}' expected endpoint '${fixture.endpointId}' but received '${request.endpointId}'.`
			);
		}

		return {
			endpointId: request.endpointId,
			payload: structuredClone(fixture.payload),
			cacheStatus: 'hit',
			sourceStatus: 'ok',
			latencyMs: 0,
			stale: false,
			isProvisional: false,
			parserVersion: 'eval-v1'
		};
	};
}

/* Helper functions */

function buildScottieShotChartPayload(): unknown {
	const matchingRows = Array.from({ length: 73 }, (_, index) => [
		'1630567',
		'Mid-Range',
		'Pullup Jump Shot',
		index < 29 ? 1 : 0,
		index - 36,
		40 + (index % 25),
		'2PT Field Goal'
	]);
	const excludedRows = Array.from({ length: 7 }, (_, index) => [
		'1630567',
		'Mid-Range',
		'Jump Shot',
		index < 3 ? 1 : 0,
		80 + index,
		20 + index,
		'2PT Field Goal'
	]);

	return {
		resultSets: [
			{
				name: 'Shot Chart Detail',
				headers: ['PLAYER_ID', 'SHOT_ZONE_BASIC', 'ACTION_TYPE', 'SHOT_MADE_FLAG', 'LOC_X', 'LOC_Y', 'SHOT_TYPE'],
				rowSet: [...matchingRows, ...excludedRows]
			}
		]
	};
}

function buildTopAssistsPayload(): unknown {
	const leaders = [
		['Tyrese Haliburton', 11.2],
		['Trae Young', 11.0],
		['Nikola Jokic', 10.2],
		['Luka Doncic', 9.8],
		['James Harden', 9.1]
	];
	const remaining = Array.from({ length: 155 }, (_, index) => [`Player ${index + 6}`, Number((9 - index * 0.03).toFixed(2))]);

	return {
		resultSets: [
			{
				name: 'LeagueDashPlayerStats',
				headers: ['PLAYER_ID', 'PLAYER', 'AST'],
				rowSet: [...leaders, ...remaining].map(([name, assists], index) => [String(1000 + index), name, assists])
			}
		]
	};
}
