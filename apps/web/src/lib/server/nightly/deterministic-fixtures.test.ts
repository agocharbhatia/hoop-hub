import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import {
	buildRawEndpointCacheKey,
	getEndpointCatalogEntry,
	getDataStore,
	resetDataStoreForTests,
	stableStringify,
	type EndpointFetchRequest
} from '$lib/server/data';
import { createNightlyBootstrapFixtureFetcher } from './bootstrap-fixtures';
import {
	findDeterministicFixturePayload,
	listDeterministicFixtureEntries,
	listDeterministicLookupFixtureSurface
} from './deterministic-fixtures';
import { seedSemanticFixtureCache } from '../../../tests/helpers/seed-semantic-fixture-cache';

const ORIGINAL_DB_PATH = process.env.HOOP_HUB_DB_PATH;

/* Helper functions */

function extractFirstResultSetColumns(payload: unknown): string[] {
	const candidate = payload as {
		resultSet?: { headers?: unknown };
		resultSets?: Array<{ headers?: unknown }>;
	};
	const resultSet =
		(candidate.resultSet && Array.isArray(candidate.resultSet.headers)
			? candidate.resultSet
			: null) ??
		(Array.isArray(candidate.resultSets)
			? candidate.resultSets.find((entry) => Array.isArray(entry.headers))
			: null);

	if (!resultSet || !Array.isArray(resultSet.headers)) {
		throw new Error('Expected a readable deterministic fixture result set.');
	}
	return (resultSet.headers as unknown[]).map((value) => String(value));
}

function loadSeededPayload(request: EndpointFetchRequest, snapshotDate: string): unknown {
	const catalogEntry = getEndpointCatalogEntry(request.endpointId);
	if (!catalogEntry) {
		throw new Error(`Missing endpoint catalog entry for '${request.endpointId}'.`);
	}

	const normalizedParams = JSON.parse(stableStringify(request.params)) as Record<string, string>;
	const row = getDataStore().getRawEndpointCache(
		buildRawEndpointCacheKey({
			endpointId: request.endpointId,
			params: normalizedParams,
			parserVersion: catalogEntry.parserVersion,
			snapshotDate
		})
	);

	if (!row) {
		throw new Error(`Missing seeded cache row for '${request.endpointId}'.`);
	}
	return JSON.parse(row.payloadJson) as unknown;
}

describe('deterministic lookup fixtures', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		resetDataStoreForTests();
	});

	afterEach(() => {
		resetDataStoreForTests();
	});

	after(() => {
		process.env.HOOP_HUB_DB_PATH = ORIGINAL_DB_PATH;
	});

	test('cover the supported lookup metric columns for every richer season source payload', () => {
		for (const requirement of listDeterministicLookupFixtureSurface()) {
			const payload = findDeterministicFixturePayload({
				endpointId: requirement.endpointId,
				params: requirement.params
			});

			assert.notEqual(payload, null);
			const columns = extractFirstResultSetColumns(payload);
			for (const column of requirement.requiredColumns) {
				assert.equal(
					columns.includes(column),
					true,
					`Expected ${requirement.endpointId} to expose ${column} for ${requirement.metricIds.join(', ')}.`
				);
			}
		}
	});

	test('seeded cache rows use the same deterministic payloads as the shared fixture registry', () => {
		const now = new Date('2026-04-02T05:00:00.000Z');
		seedSemanticFixtureCache(now);

		for (const entry of listDeterministicFixtureEntries()) {
			const seededPayload = loadSeededPayload(
				{
					endpointId: entry.endpointId,
					params: entry.params
				},
				now.toISOString().slice(0, 10)
			);

			assert.deepEqual(seededPayload, entry.payload);
		}
	});

	test('fixture bootstrap fetcher returns the same shared deterministic payloads for every supported request', async () => {
		const fetcher = createNightlyBootstrapFixtureFetcher();

		for (const entry of listDeterministicFixtureEntries()) {
			const result = await fetcher({
				endpointId: entry.endpointId,
				params: entry.params
			});

			assert.equal(result.sourceStatus, 'ok');
			assert.deepEqual(result.payload, entry.payload);
		}
	});
});
