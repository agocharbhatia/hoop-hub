import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GET } from '../../routes/api/health/+server';

async function parseJson(response: Response): Promise<unknown> {
	return response.json();
}

describe('GET /api/health', () => {
	test('returns expected service health payload', async () => {
		const response = await GET({} as Parameters<typeof GET>[0]);
		const payload = (await parseJson(response)) as {
			status: string;
			service: string;
			timestamp: string;
		};

		assert.equal(response.status, 200);
		assert.equal(payload.status, 'ok');
		assert.equal(payload.service, 'web');
		assert.equal(Number.isNaN(Date.parse(payload.timestamp)), false);
	});
});
