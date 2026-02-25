import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { POST } from '../../routes/api/chat/query/+server';

function createPostEvent(body: BodyInit): Parameters<typeof POST>[0] {
	return {
		request: new Request('http://localhost/api/chat/query', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		})
	} as Parameters<typeof POST>[0];
}

async function parseJson(response: Response): Promise<unknown> {
	return response.json();
}

describe('POST /api/chat/query', () => {
	test('returns 400 for invalid json body', async () => {
		const response = await POST(createPostEvent('{invalid-json'));
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.equal(payload.error, 'Invalid JSON body.');
	});

	test('returns 400 for invalid request schema', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					sessionId: 'session-1',
					message: '   '
				})
			)
		);
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 400);
		assert.match(payload.error, /message is required/i);
	});

	test('returns 200 ok with stable response shape for supported query', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					sessionId: 'session-1',
					message: 'Who averaged the most assists in 2023-24?'
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			answer: string;
			citations: unknown[];
			traceId: string;
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.answer.length > 0, true);
		assert.equal(payload.citations.length > 0, true);
		assert.equal(payload.traceId.length > 0, true);
	});

	test('returns 200 unsupported for ungrounded query', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					sessionId: 'session-1',
					message: 'Who wins the championship this year?'
				})
			)
		);
		const payload = (await parseJson(response)) as {
			status: string;
			answer: string;
			citations: unknown[];
			traceId: string;
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'unsupported');
		assert.equal(payload.answer.length > 0, true);
		assert.equal(payload.citations.length, 0);
		assert.equal(payload.traceId.length > 0, true);
	});

	test('returns 500 on planner invariant failures', async () => {
		const response = await POST(
			createPostEvent(
				JSON.stringify({
					sessionId: 'session-1',
					message: 'Compare Stephen Curry vs Damian Lillard by defensive rating'
				})
			)
		);
		const payload = (await parseJson(response)) as { error: string };

		assert.equal(response.status, 500);
		assert.equal(payload.error, 'Internal query planning error.');
	});
});
