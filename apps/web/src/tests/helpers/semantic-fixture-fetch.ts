import { readFileSync } from 'node:fs';

function loadFixture(relativePath: string): unknown {
	return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as unknown;
}

const PLAYER_STATS_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/leaguedashplayerstats.json');
const JOKIC_GAME_LOG_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/playergamelog-jokic.json');
const ACHIUWA_GAME_LOG_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/playergamelog-achiuwa.json');
const CURRY_CAREER_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/playercareerstats-curry.json');
const LILLARD_CAREER_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/playercareerstats-lillard.json');
const ACHIUWA_CAREER_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/playercareerstats-achiuwa.json');
const TEAM_STATS_FIXTURE = loadFixture('../../lib/server/semantic/fixtures/leaguedashteamstats.json');

const PLAYER_CAREER_BY_ID = new Map<string, unknown>([
	['201939', CURRY_CAREER_FIXTURE],
	['203081', LILLARD_CAREER_FIXTURE],
	['1630173', ACHIUWA_CAREER_FIXTURE]
]);

const PLAYER_GAME_LOG_BY_ID = new Map<string, unknown>([
	['203999', JOKIC_GAME_LOG_FIXTURE],
	['1630173', ACHIUWA_GAME_LOG_FIXTURE]
]);

function makeJsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			'content-type': 'application/json'
		}
	});
}

export function installSemanticFixtureFetch(): () => void {
	const originalFetch = globalThis.fetch;

	globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
		const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);

		if (url.pathname.endsWith('/stats/leaguedashplayerstats')) {
			return makeJsonResponse(PLAYER_STATS_FIXTURE);
		}

		if (url.pathname.endsWith('/stats/playergamelog')) {
			const payload = PLAYER_GAME_LOG_BY_ID.get(url.searchParams.get('PlayerID') ?? '');
			return payload ? makeJsonResponse(payload) : makeJsonResponse({ error: 'missing fixture' }, 404);
		}

		if (url.pathname.endsWith('/stats/playercareerstats')) {
			const payload = PLAYER_CAREER_BY_ID.get(url.searchParams.get('PlayerID') ?? '');
			return payload ? makeJsonResponse(payload) : makeJsonResponse({ error: 'missing fixture' }, 404);
		}

		if (url.pathname.endsWith('/stats/leaguedashteamstats')) {
			return makeJsonResponse(TEAM_STATS_FIXTURE);
		}

		return makeJsonResponse({ error: `No semantic fixture registered for ${url.pathname}` }, 404);
	}) as typeof fetch;

	return () => {
		globalThis.fetch = originalFetch;
	};
}
