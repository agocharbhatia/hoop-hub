import { readFileSync } from 'node:fs';
import { getEndpointCatalogEntry } from '$lib/server/data/catalog';
import { buildRawEndpointCacheKey, getDataStore, stableStringify } from '$lib/server/data/store';

type CachedFixtureInput = {
	endpointId: string;
	params: Record<string, string>;
	payload: unknown;
	now: Date;
};

/* Helper functions */

function loadFixture(relativePath: string): unknown {
	return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as unknown;
}

function putCachedFixture({ endpointId, params, payload, now }: CachedFixtureInput): void {
	const catalogEntry = getEndpointCatalogEntry(endpointId);
	if (!catalogEntry) {
		throw new Error(`Missing endpoint catalog entry for '${endpointId}'.`);
	}

	const normalizedParams = JSON.parse(stableStringify(params)) as Record<string, string>;
	const snapshotDate = now.toISOString().slice(0, 10);
	const cacheKey = buildRawEndpointCacheKey({
		endpointId,
		params: normalizedParams,
		parserVersion: catalogEntry.parserVersion,
		snapshotDate
	});

	getDataStore().putRawEndpointCache({
		cacheKey,
		endpointId,
		paramsJson: JSON.stringify(normalizedParams),
		payloadJson: JSON.stringify(payload),
		fetchedAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
		snapshotDate,
		parserVersion: catalogEntry.parserVersion,
		isProvisional: false
	});
}

const PLAYER_STATS_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/leaguedashplayerstats.json');
const JOKIC_GAME_LOG_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/playergamelog-jokic.json');
const ACHIUWA_GAME_LOG_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/playergamelog-achiuwa.json');
const CURRY_CAREER_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/playercareerstats-curry.json');
const LILLARD_CAREER_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/playercareerstats-lillard.json');
const ACHIUWA_CAREER_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/playercareerstats-achiuwa.json');
const TEAM_STATS_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/leaguedashteamstats.json');

/* Public cache seed API */

export function seedSemanticFixtureCache(now: Date = new Date()): void {
	putCachedFixture({
		endpointId: 'leaguedashplayerstats',
		now,
		payload: PLAYER_STATS_FIXTURE,
		params: {
			DateFrom: '',
			DateTo: '',
			GameScope: '',
			GameSegment: '',
			LastNGames: '0',
			Location: '',
			MeasureType: 'Base',
			Month: '0',
			OpponentTeamID: '0',
			Outcome: '',
			PaceAdjust: 'N',
			PerMode: 'PerGame',
			Period: '0',
			PlayerExperience: '',
			PlayerPosition: '',
			PlusMinus: 'N',
			Rank: 'N',
			Season: '2023-24',
			SeasonSegment: '',
			SeasonType: 'Regular Season',
			StarterBench: '',
			VsConference: '',
			VsDivision: '',
			Conference: '',
			Division: '',
			LeagueID: '',
			PORound: '',
			ShotClockRange: '',
			TeamID: '',
			TwoWay: ''
		}
	});

	for (const season of ['2023-24', '2025-26']) {
		for (const [playerId, payload] of [
			['203999', JOKIC_GAME_LOG_FIXTURE],
			['1630173', ACHIUWA_GAME_LOG_FIXTURE]
		] as const) {
			putCachedFixture({
				endpointId: 'playergamelog',
				now,
				payload,
				params: {
					PlayerID: playerId,
					Season: season,
					SeasonType: 'Regular Season',
					LeagueID: '',
					DateFrom: '',
					DateTo: ''
				}
			});
		}
	}

	for (const [playerId, payload] of [
		['201939', CURRY_CAREER_FIXTURE],
		['203081', LILLARD_CAREER_FIXTURE],
		['1630173', ACHIUWA_CAREER_FIXTURE]
	] as const) {
		putCachedFixture({
			endpointId: 'playercareerstats',
			now,
			payload,
			params: {
				PerMode: 'PerGame',
				PlayerID: playerId,
				LeagueID: ''
			}
		});
	}

	putCachedFixture({
		endpointId: 'leaguedashteamstats',
		now,
		payload: TEAM_STATS_FIXTURE,
		params: {
			DateFrom: '',
			DateTo: '',
			GameSegment: '',
			LastNGames: '0',
			Location: '',
			MeasureType: 'Advanced',
			Month: '0',
			OpponentTeamID: '0',
			Outcome: '',
			PaceAdjust: 'N',
			PerMode: 'PerGame',
			Period: '0',
			PlusMinus: 'N',
			Rank: 'N',
			Season: '2023-24',
			SeasonSegment: '',
			SeasonType: 'Regular Season',
			VsConference: '',
			VsDivision: '',
			Conference: '',
			Division: '',
			GameScope: '',
			LeagueID: '',
			PORound: '',
			PlayerExperience: '',
			PlayerPosition: '',
			ShotClockRange: '',
			StarterBench: '',
			TeamID: '',
			TwoWay: ''
		}
	});
}
