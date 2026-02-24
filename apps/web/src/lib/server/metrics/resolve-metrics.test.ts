import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetricQuery, resolveMetrics, validateMetricsForIntent } from './resolve-metrics';

describe('resolveMetrics', () => {
	test('maps aliases to canonical metric IDs', () => {
		const normalized = normalizeMetricQuery('Who leads the league in dimes in 2023-24?');
		const result = resolveMetrics(normalized);
		assert.deepEqual(
			result.metrics.map((m) => m.id),
			['ast']
		);
	});

	test('resolves defensive rating phrase alias', () => {
		const normalized = normalizeMetricQuery('Which teams have the best defensive rating?');
		const result = resolveMetrics(normalized);
		assert.deepEqual(
			result.metrics.map((m) => m.id),
			['drtg']
		);
	});

	test('captures unresolved metric cues not yet in registry', () => {
		const normalized = normalizeMetricQuery('Show me team deflections this season');
		const result = resolveMetrics(normalized);
		assert.equal(result.metrics.length, 0);
		assert.deepEqual(result.unresolvedTerms, ['deflections']);
	});
});

describe('validateMetricsForIntent', () => {
	test('allows ast for league_leaders', () => {
		const result = validateMetricsForIntent('league_leaders', [{ id: 'ast', confidence: 0.9 }]);
		assert.deepEqual(result, { ok: true });
	});

	test('rejects drtg for player_compare', () => {
		const result = validateMetricsForIntent('player_compare', [{ id: 'drtg', confidence: 0.9 }]);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.match(result.error, /not allowed/);
		}
	});
});
