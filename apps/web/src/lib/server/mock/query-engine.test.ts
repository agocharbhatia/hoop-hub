import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getTraceById, normalizeQuestion, runMockQuery, validateChatQueryRequest } from './query-engine';

describe('normalizeQuestion', () => {
	test('normalizes whitespace and lowercases', () => {
		assert.equal(normalizeQuestion('  Who   Leads AST In 2023-24?  '), 'who leads ast in 2023-24?');
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
	test('returns ok response with citations for supported question', () => {
		const response = runMockQuery({
			sessionId: 'session-1',
			message: 'Who averaged the most assists in 2023-24?'
		});

		assert.equal(response.status, 'ok');
		assert.equal(response.citations.length > 0, true);
		assert.equal(response.traceId.length > 0, true);

		const trace = getTraceById(response.traceId);
		assert.notEqual(trace, null);
		assert.equal((trace?.executedSources.length ?? 0) > 0, true);
	});

	test('returns unsupported with 200-compatible payload shape for unknown questions', () => {
		const response = runMockQuery({
			sessionId: 'session-1',
			message: 'Who wins the championship this year?'
		});

		assert.equal(response.status, 'unsupported');
		assert.equal(response.traceId.length > 0, true);

		const trace = getTraceById(response.traceId);
		assert.notEqual(trace, null);
		assert.equal((trace?.planSummary.length ?? 0) > 0, true);
	});
});
