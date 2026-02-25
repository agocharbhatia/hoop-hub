import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { QueryPlan } from '$lib/contracts/query-plan';
import { buildQueryPlan, normalizeQuestion, validateQueryPlan } from './query-plan';

describe('normalizeQuestion', () => {
	test('normalizes text for deterministic parsing', () => {
		assert.equal(normalizeQuestion('  WHO   Leads AST in 2023-24?!  '), 'who leads ast in 2023-24');
	});
});

describe('buildQueryPlan', () => {
	test('builds league_leaders for assist leader query', () => {
		const plan = buildQueryPlan(normalizeQuestion('Who averaged the most assists in 2023-24?'));

		assert.equal(plan.intent, 'league_leaders');
		assert.equal(plan.metrics.some((metric) => metric.id === 'ast'), true);
		assert.equal(plan.filters.season, '2023-24');
		assert.deepEqual(validateQueryPlan(plan), { ok: true });
	});

	test('builds player_compare for curry vs lillard comparison', () => {
		const plan = buildQueryPlan(normalizeQuestion('Compare Stephen Curry vs Damian Lillard this season'));

		assert.equal(plan.intent, 'player_compare');
		assert.equal(plan.entities.players.length >= 2, true);
		assert.deepEqual(validateQueryPlan(plan), { ok: true });
	});

	test('builds player_trend for last-N player query', () => {
		const plan = buildQueryPlan(normalizeQuestion('Show Nikola Jokic rebounds over his last 10 games'));

		assert.equal(plan.intent, 'player_trend');
		assert.equal(plan.filters.window?.type, 'last_n_games');
		assert.equal(plan.filters.window?.n, 10);
		assert.equal(plan.metrics.some((metric) => metric.id === 'reb'), true);
		assert.deepEqual(validateQueryPlan(plan), { ok: true });
	});

	test('returns unsupported for unknown prompt', () => {
		const plan = buildQueryPlan(normalizeQuestion('Who wins the championship this year?'));

		assert.equal(plan.intent, 'unsupported');
		assert.equal(plan.confidence < 0.5, true);
		assert.deepEqual(validateQueryPlan(plan), { ok: true });
	});

	test('builds team_ranking for defensive rating team question', () => {
		const plan = buildQueryPlan(normalizeQuestion('Which teams have the best defensive rating this season?'));

		assert.equal(plan.intent, 'team_ranking');
		assert.equal(plan.metrics.some((metric) => metric.id === 'drtg'), true);
		assert.deepEqual(validateQueryPlan(plan), { ok: true });
	});

	test('applies default metric for compare query without explicit metric', () => {
		const plan = buildQueryPlan(normalizeQuestion('Compare Stephen Curry vs Damian Lillard this season'));

		assert.equal(plan.intent, 'player_compare');
		assert.equal(plan.metrics.some((metric) => metric.id === 'pts'), true);
		assert.equal(plan.confidence <= 0.6, true);
		assert.deepEqual(validateQueryPlan(plan), { ok: true });
	});

	test('downgrades to unsupported when unresolved metric cues are present', () => {
		const plan = buildQueryPlan(normalizeQuestion('Show Stephen Curry trend for steals this season'));

		assert.equal(plan.intent, 'unsupported');
		assert.equal(plan.reasons.some((reason) => reason.includes('Unsupported metric cues detected')), true);
		assert.deepEqual(validateQueryPlan(plan), { ok: true });
	});
});

describe('validateQueryPlan', () => {
	test('rejects invalid season format', () => {
		const invalidPlan: QueryPlan = {
			intent: 'league_leaders',
			entities: {
				players: [],
				teams: [],
				seasons: ['2023']
			},
			metrics: [{ id: 'ast', confidence: 0.8 }],
			filters: {
				season: '2023',
				window: null
			},
			confidence: 0.8,
			reasons: ['test']
		};

		const result = validateQueryPlan(invalidPlan);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.match(result.error, /Season filter/);
		}
	});

	test('rejects unsupported plans with high confidence', () => {
		const invalidPlan: QueryPlan = {
			intent: 'unsupported',
			entities: {
				players: [],
				teams: [],
				seasons: []
			},
			metrics: [],
			filters: {
				season: null,
				window: null
			},
			confidence: 0.8,
			reasons: ['test']
		};

		const result = validateQueryPlan(invalidPlan);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.match(result.error, /Unsupported QueryPlan confidence/);
		}
	});

	test('rejects supported intents with no metrics', () => {
		const invalidPlan: QueryPlan = {
			intent: 'league_leaders',
			entities: {
				players: [],
				teams: [],
				seasons: []
			},
			metrics: [],
			filters: {
				season: null,
				window: null
			},
			confidence: 0.7,
			reasons: ['test']
		};

		const result = validateQueryPlan(invalidPlan);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.match(result.error, /require at least one metric/);
		}
	});

	test('rejects player_compare plans with fewer than two players', () => {
		const invalidPlan: QueryPlan = {
			intent: 'player_compare',
			entities: {
				players: ['stephen curry'],
				teams: [],
				seasons: []
			},
			metrics: [{ id: 'pts', confidence: 0.8 }],
			filters: {
				season: null,
				window: null
			},
			confidence: 0.8,
			reasons: ['test']
		};

		const result = validateQueryPlan(invalidPlan);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.match(result.error, /at least two players/);
		}
	});

	test('rejects non-positive window filter values', () => {
		const invalidPlan: QueryPlan = {
			intent: 'player_trend',
			entities: {
				players: ['nikola jokic'],
				teams: [],
				seasons: []
			},
			metrics: [{ id: 'reb', confidence: 0.8 }],
			filters: {
				season: null,
				window: { type: 'last_n_games', n: 0 }
			},
			confidence: 0.8,
			reasons: ['test']
		};

		const result = validateQueryPlan(invalidPlan);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.match(result.error, /positive integer/);
		}
	});
});
