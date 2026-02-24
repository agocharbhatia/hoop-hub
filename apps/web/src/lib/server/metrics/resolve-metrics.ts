import type { MetricDefinition } from '$lib/contracts/metrics';
import type { MetricSelection, QueryIntent } from '$lib/contracts/query-plan';
import { getMetricById, listMetricDefinitions } from './registry';

const NON_ALPHANUMERIC = /[^a-z0-9\s-]+/g;
const METRIC_CUE_WORDS = new Set([
	'assist',
	'assists',
	'dime',
	'dimes',
	'apg',
	'rebound',
	'rebounds',
	'boards',
	'point',
	'points',
	'ppg',
	'scoring',
	'defensive rating',
	'def rating',
	'drtg',
	'deflections',
	'steals',
	'blocks'
]);

type Resolution = {
	metrics: MetricSelection[];
	unresolvedTerms: string[];
	reasons: string[];
};

export function normalizeMetricQuery(query: string): string {
	return query
		.toLowerCase()
		.replace(NON_ALPHANUMERIC, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function queryContainsAlias(normalizedQuery: string, alias: string): boolean {
	if (alias.includes(' ')) {
		return normalizedQuery.includes(alias);
	}
	return normalizedQuery.split(' ').includes(alias);
}

export function resolveMetrics(normalizedQuery: string): Resolution {
	const matched = new Set<string>();
	const reasons: string[] = [];
	const unresolvedTerms = new Set<string>();

	for (const metric of listMetricDefinitions()) {
		if (metric.aliases.some((alias) => queryContainsAlias(normalizedQuery, alias))) {
			matched.add(metric.id);
			reasons.push(`Matched metric '${metric.id}' from aliases.`);
		}
	}

	for (const cue of METRIC_CUE_WORDS) {
		if (queryContainsAlias(normalizedQuery, cue)) {
			const resolvedByAlias = listMetricDefinitions().some((metric) => metric.aliases.includes(cue));
			if (!resolvedByAlias) {
				unresolvedTerms.add(cue);
			}
		}
	}

	return {
		metrics: Array.from(matched).map((id) => ({ id, confidence: 0.85 })),
		unresolvedTerms: Array.from(unresolvedTerms),
		reasons
	};
}

export function validateMetricsForIntent(intent: QueryIntent, metrics: MetricSelection[]): { ok: true } | { ok: false; error: string } {
	for (const metric of metrics) {
		const definition: MetricDefinition | undefined = getMetricById(metric.id);
		if (!definition) {
			return { ok: false, error: `Unknown metric id '${metric.id}'.` };
		}
		if (!definition.allowedIntents.includes(intent)) {
			return { ok: false, error: `Metric '${metric.id}' is not allowed for intent '${intent}'.` };
		}
	}
	return { ok: true };
}
