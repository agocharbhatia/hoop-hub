import { error } from '@sveltejs/kit';
import { getBetaConfig } from '$lib/server/beta/config';
import { getDataStore } from '$lib/server/data/store/data-store';
import { buildRawEndpointCacheKey, stableStringify } from '$lib/server/data/store/cache-key';
import { normalizeEndpointParams } from '$lib/server/data/adapters/stats-endpoint-client';
import { getEndpointCatalogEntry } from '$lib/server/data/catalog';
import { researchRepository } from '$lib/server/research/repository';
import { researchUIFixtures, shootingFixture } from '$lib/server/research/ui-fixtures';
import { splitUIFixtures } from '$lib/server/research/split-fixtures';
import type { PageServerLoad } from './$types';

/** This opt-in lab seeds only an explicitly configured disposable local database. */
export const load: PageServerLoad = () => {
	if (getBetaConfig().mode !== 'local' || process.env.HOOP_HUB_UI_FIXTURES !== '1' || !process.env.HOOP_HUB_DB_PATH) error(404, 'Not found');
	const now = new Date(), snapshotDate = now.toISOString().slice(0, 10);
	for (const entity of ['player', 'team'] as const) for (const season of ['2025-26', '2024-25']) for (const [dateFrom, dateTo] of [['', ''], [`${Number(season.slice(0, 4)) + 1}-01-01`, `${Number(season.slice(0, 4)) + 1}-03-31`]]) {
		const fixture = shootingFixture(entity, season, dateFrom, dateTo), entry = getEndpointCatalogEntry(fixture.source.endpointId)!;
		const params = normalizeEndpointParams(fixture.source.endpointId, fixture.source.request.params as Record<string, string>);
		getDataStore().putRawEndpointCache({ cacheKey: buildRawEndpointCacheKey({ endpointId: entry.endpointId, params, parserVersion: entry.parserVersion, snapshotDate }), endpointId: fixture.source.endpointId, paramsJson: stableStringify(params), payloadJson: JSON.stringify(fixture.payload), fetchedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), snapshotDate, parserVersion: entry.parserVersion, isProvisional: false });
	}
	return { examples: [...splitUIFixtures(), ...researchUIFixtures()].map(fixture => { const sessionId = crypto.randomUUID(); const saved = researchRepository.saveResult(sessionId, fixture)!; return { key: fixture.key, question: fixture.question, response: { ...fixture.response, sessionId, researchTurnId: saved.turnId } }; }) };
};
