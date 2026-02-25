import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	getTraceById,
	isQueryEngineInvariantError,
	normalizeQuestion,
	runMockQuery,
	validateChatQueryRequest
} from './query-engine';

describe('normalizeQuestion', () => {
	test('normalizes whitespace, case, and punctuation', () => {
		assert.equal(normalizeQuestion('  Who   Leads AST In 2023-24?  '), 'who leads ast in 2023-24');
	});
});

describe('validateChatQueryRequest', () => {
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
	test('returns ok response with citations and rich trace for supported questions', () => {
		const response = runMockQuery({
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
		assert.equal((trace?.computations.length ?? 0) === 0, true);
		assert.equal((trace?.latencyMs.total ?? 0) > 0, true);
		assert.equal(
			trace?.latencyMs.total,
			(trace?.latencyMs.planning ?? 0) +
				(trace?.latencyMs.retrieval ?? 0) +
				(trace?.latencyMs.compute ?? 0) +
				(trace?.latencyMs.render ?? 0)
		);
		assert.deepEqual(trace?.cache, { hits: 0, misses: 0 });
	});

	test('returns unsupported with 200-compatible payload shape and unsupported trace', () => {
		const response = runMockQuery({
			sessionId: 'session-1',
			message: 'Who wins the championship this year?'
		});

		assert.equal(response.status, 'unsupported');
		assert.equal(response.traceId.length > 0, true);

		const trace = getTraceById(response.traceId);
		assert.notEqual(trace, null);
		assert.equal(trace?.queryPlan.intent, 'unsupported');
		assert.deepEqual(trace?.executedSources, []);
		assert.deepEqual(trace?.cache, { hits: 0, misses: 0 });
		assert.equal((trace?.latencyMs.total ?? 0) > 0, true);
	});

	test('throws invariant error when planner generates invalid supported plan', () => {
		assert.throws(
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
