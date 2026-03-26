import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import { resetDataStoreForTests } from '$lib/server/data/store';
import {
	getTraceById,
	isQueryEngineInvariantError,
	normalizeQuestion,
	runMockQuery,
	validateChatQueryRequest
} from './query-engine';

const ORIGINAL_LIVE_FETCH = process.env.HOOP_HUB_ENABLE_LIVE_NBA;

describe('normalizeQuestion', () => {
	test('normalizes whitespace, case, and punctuation', () => {
		assert.equal(normalizeQuestion('  Who   Leads AST In 2023-24?  '), 'who leads ast in 2023-24');
	});
});

describe('validateChatQueryRequest', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
	});

	test('accepts valid payloads', () => {
		const result = validateChatQueryRequest({
			sessionId: 'session-1',
			message: 'Who averaged the most assists in 2023-24?',
			clientTs: '2026-02-24T00:00:00Z'
		});
		assert.equal(result.ok, true);
	});

	test('rejects empty message', () => {
		const result = validateChatQueryRequest({
			sessionId: 'session-1',
			message: '   '
		});
		assert.equal(result.ok, false);
	});
});

describe('runMockQuery + getTraceById', () => {
	beforeEach(() => {
		process.env.HOOP_HUB_DB_PATH = ':memory:';
		process.env.HOOP_HUB_ENABLE_LIVE_NBA = '0';
		resetDataStoreForTests();
	});

	test('returns ok response with citations and rich trace for supported questions', async () => {
		const response = await runMockQuery({
			sessionId: 'session-1',
			message: 'Who averaged the most assists in 2023-24?'
		});

		assert.equal(response.status, 'ok');
		assert.equal(response.citations.length > 0, true);
		assert.equal(response.traceId.length > 0, true);

		const trace = getTraceById(response.traceId);
		assert.notEqual(trace, null);
		assert.equal((trace?.queryPlan.intent ?? '') !== 'unsupported', true);
		assert.equal((trace?.executedSources.length ?? 0) > 0, true);
		assert.equal(trace?.dataFreshnessMode, 'nightly');
		assert.equal((trace?.sourceCalls.length ?? 0) > 0, true);
		assert.equal(trace?.sourceCalls.every((source) => source.endpointId.length > 0), true);
		assert.equal((trace?.computations.length ?? 0) === 0, true);
		assert.equal((trace?.latencyMs.total ?? 0) > 0, true);
		assert.equal(
			trace?.latencyMs.total,
			(trace?.latencyMs.planning ?? 0) +
				(trace?.latencyMs.retrieval ?? 0) +
				(trace?.latencyMs.compute ?? 0) +
				(trace?.latencyMs.render ?? 0)
		);
		assert.equal((trace?.cache.hits ?? 0) + (trace?.cache.misses ?? 0) > 0, true);
	});

	test('returns unsupported with 200-compatible payload shape and unsupported trace', async () => {
		const response = await runMockQuery({
			sessionId: 'session-1',
			message: 'Who wins the championship this year?'
		});

		assert.equal(response.status, 'unsupported');
		assert.equal(response.traceId.length > 0, true);

		const trace = getTraceById(response.traceId);
		assert.notEqual(trace, null);
		assert.equal(trace?.queryPlan.intent, 'unsupported');
		assert.deepEqual(trace?.executedSources, []);
		assert.equal(trace?.dataFreshnessMode, 'nightly');
		assert.deepEqual(trace?.sourceCalls, []);
		assert.deepEqual(trace?.cache, { hits: 0, misses: 0 });
		assert.equal((trace?.latencyMs.total ?? 0) > 0, true);
	});

	test('handles player trend intent with windowed filters', async () => {
		const response = await runMockQuery({
			sessionId: 'session-1',
			message: 'Show Nikola Jokic rebounds over his last 10 games'
		});
		const trace = getTraceById(response.traceId);

		assert.equal(response.status, 'ok');
		assert.equal(trace?.queryPlan.intent, 'player_trend');
		assert.equal(trace?.queryPlan.filters.window?.type, 'last_n_games');
		assert.equal(trace?.queryPlan.filters.window?.n, 10);
		assert.equal((trace?.executedSources.length ?? 0) > 0, true);
		assert.equal(trace?.sourceCalls.some((source) => source.endpointId === 'playergamelog'), true);
	});

	test('handles seeded directory players outside the legacy hardcoded map', async () => {
		const response = await runMockQuery({
			sessionId: 'session-1',
			message: 'Show Precious Achiuwa points over his last 5 games'
		});
		const trace = getTraceById(response.traceId);

		assert.equal(response.status, 'ok');
		assert.equal(trace?.queryPlan.intent, 'player_trend');
		assert.deepEqual(trace?.queryPlan.entities.players, ['Precious Achiuwa']);
		assert.equal(trace?.sourceCalls.some((source) => source.endpointId === 'playergamelog'), true);
	});

	test('handles curated aliases through the shared player directory overlay', async () => {
		const response = await runMockQuery({
			sessionId: 'session-1',
			message: 'Show Steph trend for points in the last 2 games'
		});
		const trace = getTraceById(response.traceId);

		assert.equal(response.status, 'ok');
		assert.equal(trace?.queryPlan.intent, 'player_trend');
		assert.deepEqual(trace?.queryPlan.entities.players, ['Stephen Curry']);
		assert.equal(trace?.sourceCalls.some((source) => source.endpointId === 'playergamelog'), true);
	});

	test('handles team ranking intent for defensive rating queries', async () => {
		const response = await runMockQuery({
			sessionId: 'session-1',
			message: 'Which teams have the best defensive rating this season?'
		});
		const trace = getTraceById(response.traceId);

		assert.equal(response.status, 'ok');
		assert.equal(trace?.queryPlan.intent, 'team_ranking');
		assert.equal(trace?.queryPlan.metrics.some((metric) => metric.id === 'drtg'), true);
		assert.equal((trace?.executedSources.length ?? 0) > 0, true);
		assert.equal(trace?.sourceCalls.some((source) => source.endpointId === 'leaguedashteamstats'), true);
	});

	test('handles player compare intent with default metric fallback', async () => {
		const response = await runMockQuery({
			sessionId: 'session-1',
			message: 'Compare Stephen Curry vs Damian Lillard this season'
		});
		const trace = getTraceById(response.traceId);

		assert.equal(response.status, 'ok');
		assert.equal(trace?.queryPlan.intent, 'player_compare');
		assert.equal(trace?.queryPlan.metrics.some((metric) => metric.id === 'pts'), true);
		assert.equal((trace?.queryPlan.confidence ?? 0) <= 0.6, true);
	});

	test('throws invariant error when planner generates invalid supported plan', async () => {
		await assert.rejects(
			() =>
				runMockQuery({
					sessionId: 'session-1',
					message: 'Compare Stephen Curry vs Damian Lillard by defensive rating'
				}),
			(error: unknown) => {
				assert.equal(isQueryEngineInvariantError(error), true);
				return true;
			}
		);
	});
});

after(() => {
	process.env.HOOP_HUB_ENABLE_LIVE_NBA = ORIGINAL_LIVE_FETCH;
});
