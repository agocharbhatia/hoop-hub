import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { QuerySessionExpiredError } from '$lib/server/agent/query-session-store';
import { POST, _setQueryRouteDependenciesForTests } from '../../routes/api/query/+server';

afterEach(() => _setQueryRouteDependenciesForTests(null));

describe('query context route boundaries', () => {
	test('forwards only a validated session identifier to the runtime', async () => {
		const sessionId = crypto.randomUUID();
		let received: unknown;
		_setQueryRouteDependenciesForTests({ async answerQuestion(question, options) {
			received = { question, options };
			return { sessionId, status: 'ok', answer: 'Answer', artifacts: [], toolResults: [], citations: [], warnings: [], traceId: 'trace' };
		} });
		const response = await post({ question: '  Now include misses.  ', sessionId });
		assert.equal(response.status, 200);
		assert.deepEqual(received, { question: 'Now include misses.', options: { sessionId } });
	});

	test('rejects malformed IDs, client tool state and oversized requests before model execution', async () => {
		let calls = 0;
		_setQueryRouteDependenciesForTests({ async answerQuestion() { calls += 1; throw new Error('Must not execute'); } });
		assert.equal((await post({ question: 'Follow up', sessionId: 'guessed' })).status, 400);
		assert.equal((await post({ question: 'Follow up', context: { playerId: '1' } })).status, 400);
		assert.equal((await post({ question: 'x'.repeat(4001) })).status, 400);
		assert.equal((await post({ question: 'x'.repeat(17_000) })).status, 413);
		assert.equal(calls, 0);
	});

	test('returns an actionable session expiry instead of silently researching another scope', async () => {
		_setQueryRouteDependenciesForTests({ async answerQuestion() { throw new QuerySessionExpiredError(); } });
		const response = await post({ question: 'include misses', sessionId: crypto.randomUUID() });
		assert.equal(response.status, 409);
		const data = await response.json();
		assert.equal(data.code, 'session_expired');
		assert.match(data.error, /Start a new research question/);
	});
});

/* Test helpers */

async function post(body: unknown): Promise<Response> {
	return POST({ request: new Request('http://localhost/api/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) } as Parameters<typeof POST>[0]);
}

/* End test helpers */
