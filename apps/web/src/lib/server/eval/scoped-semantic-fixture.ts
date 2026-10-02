import type { SemanticQuery, SemanticQueryRequest, StatsQueryResponse } from '$lib/contracts/semantic-query';
import { listMetricDefinitions } from '$lib/server/metrics/registry';
import type { EvalCase } from './types';

/** Frozen semantic rows are trustworthy only when the requested subject, metrics, and population match their provenance. */
export function createScopedSemanticFixtureExecutor(evalCase: EvalCase): (request: SemanticQueryRequest) => Promise<StatsQueryResponse> {
	const responses = evalCase.local.semanticResponses ?? [];
	const recordedQueries = evalCase.local.turns.flatMap((turn) => turn.kind === 'tools' ? turn.calls : [])
		.filter((call) => call.name === 'execute_semantic_query')
		.map((call) => call.arguments.query as SemanticQuery);
	const records = responses.map((response, index) => {
		const query = response.provenance.resolvedQuery ?? recordedQueries[index];
		if (!query) throw new Error(`Semantic fixture '${evalCase.id}' lacks query provenance.`);
		return { query, response };
	});
	return async (request) => {
		const matching = records.find(({ query }) => samePopulation(request.query, query));
		if (!matching) throw new Error(`Unrecorded semantic fixture scope for '${evalCase.id}': ${JSON.stringify(request.query)}`);
		// Matching by scope rather than call order permits safe retries and equivalent model tool paths.
		return structuredClone(matching.response);
	};
}

// --- Population comparison helpers ---

function normalizeName(value: string): string {
	return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function canonicalMetric(value: string): string {
	const normalized = value.trim().toLowerCase();
	return listMetricDefinitions().find((metric) => metric.id === normalized || metric.aliases.includes(normalized))?.id ?? normalized;
}

function sameSet(actual: string[], expected: string[]): boolean {
	return JSON.stringify([...new Set(actual)].sort()) === JSON.stringify([...new Set(expected)].sort());
}

function sameSubject(actual: SemanticQuery['subject'], expected: SemanticQuery['subject']): boolean {
	const ids = actual.ids ?? [];
	const names = (actual.names ?? []).map(normalizeName);
	const expectedIds = expected.ids ?? [];
	const expectedNames = (expected.names ?? []).map(normalizeName);
	if (!ids.length && !names.length) return !expectedIds.length && !expectedNames.length;
	if (ids.length && !sameSet(ids, expectedIds)) return false;
	if (names.length && !sameSet(names, expectedNames)) return false;
	return true;
}

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
	return value;
}

function samePopulation(actual: SemanticQuery, expected: SemanticQuery): boolean {
	if (actual.operation !== expected.operation || actual.entity !== expected.entity || !sameSubject(actual.subject, expected.subject)) return false;
	if (!sameSet(actual.metrics.map(canonicalMetric), expected.metrics.map(canonicalMetric))) return false;
	const filterKeys = new Set([...Object.keys(actual.filters), ...Object.keys(expected.filters)]);
	for (const key of filterKeys) {
		let actualValue = actual.filters[key as keyof SemanticQuery['filters']] ?? null;
		let expectedValue = expected.filters[key as keyof SemanticQuery['filters']] ?? null;
		// The fixed reference date resolves an implicit current season to the recorded season.
		if (key === 'season' && actualValue === null) actualValue = expectedValue;
		if (key === 'seasonType') {
			actualValue ??= 'Regular Season';
			expectedValue ??= 'Regular Season';
		}
		if (JSON.stringify(stableValue(actualValue)) !== JSON.stringify(stableValue(expectedValue))) return false;
	}
	const canonicalOrder = (order: SemanticQuery['orderBy']) => order ? { metric: canonicalMetric(order.metric), direction: order.direction } : null;
	return JSON.stringify(canonicalOrder(actual.orderBy)) === JSON.stringify(canonicalOrder(expected.orderBy))
		&& (actual.limit ?? null) === (expected.limit ?? null);
	// outputMode and question wording are presentation choices, not changes to the data population.
}

// --- End population comparison helpers ---
