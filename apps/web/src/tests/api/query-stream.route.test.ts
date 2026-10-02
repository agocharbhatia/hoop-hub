import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { POST, _setQueryRouteDependenciesForTests } from '../../routes/api/query/+server';
import { QuerySessionExpiredError } from '$lib/server/agent/query-session-store';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';

/* Test helpers */

const answer: QueryAnswerResponse = { status: 'ok', answer: 'Verified result.', artifacts: [], toolResults: [], warnings: [], citations: [], traceId: 'test' };

function event() {
	return { request: new Request('http://localhost/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ question: 'Show the game trend.' }) }) } as Parameters<typeof POST>[0];
}

/* Streaming route behavior */

describe('POST /api/query streaming', () => {
	afterEach(() => _setQueryRouteDependenciesForTests(null));

	test('delivers real progress and verified artifacts before the final result', async () => {
		_setQueryRouteDependenciesForTests({ async answerQuestion(_question, options) {
			options?.onProgress?.({ stage: 'fetching', message: 'Loading game logs', completedTools: 1, elapsedMs: 10 });
			options?.onArtifacts?.([{ type: 'table', shape: 'comparison', columns: ['REB'], rows: [{ REB: 12 }] }]);
			return answer;
		} });
		const response = await POST(event());
		assert.match(response.headers.get('content-type')!, /text\/event-stream/);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		const source = await response.text();
		assert.ok(source.indexOf('event: progress') < source.indexOf('event: artifacts'));
		assert.ok(source.indexOf('event: artifacts') < source.indexOf('event: result'));
		assert.match(source, /Loading game logs/);
		assert.match(source, /"REB":12/);
	});

	test('exposes an expired session as a typed stream error without a final result', async () => {
		_setQueryRouteDependenciesForTests({ async answerQuestion() { throw new QuerySessionExpiredError(); } });
		const source = await (await POST(event())).text();
		assert.match(source, /event: error/);
		assert.match(source, /session_expired/);
		assert.doesNotMatch(source, /event: result/);
	});

	test('cancelling the response reader aborts model and source work', async () => {
		let signal: AbortSignal | undefined;
		_setQueryRouteDependenciesForTests({ answerQuestion(_question, options) {
			signal = options?.signal;
			return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal?.reason), { once: true }));
		} });
		const response = await POST(event());
		const reader = response.body!.getReader();
		await reader.read();
		await reader.cancel();
		assert.equal(signal?.aborted, true);
	});
});
