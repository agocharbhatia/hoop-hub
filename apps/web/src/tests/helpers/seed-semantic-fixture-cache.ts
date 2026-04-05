import { getEndpointCatalogEntry } from '$lib/server/data/catalog';
import { buildRawEndpointCacheKey, getDataStore, stableStringify } from '$lib/server/data/store';
import { listDeterministicFixtureEntries } from '$lib/server/nightly/deterministic-fixtures';

type CachedFixtureInput = {
	endpointId: string;
	params: Record<string, string>;
	payload: unknown;
	now: Date;
};

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

/* Public cache seed API */

export function seedSemanticFixtureCache(now: Date = new Date()): void {
	for (const entry of listDeterministicFixtureEntries()) {
		putCachedFixture({
			endpointId: entry.endpointId,
			now,
			payload: entry.payload,
			params: entry.params
		});
	}
}
