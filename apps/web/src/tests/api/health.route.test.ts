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

	test('exposes the image revision so deployment checks can distinguish old and new builds', async () => {
		const previous = process.env.HOOP_HUB_REVISION;
		try {
			process.env.HOOP_HUB_REVISION = 'a'.repeat(40);
			const payload = await (await GET({} as Parameters<typeof GET>[0])).json();
			assert.equal(payload.revision, 'a'.repeat(40));
		} finally {
			if (previous === undefined) delete process.env.HOOP_HUB_REVISION;
			else process.env.HOOP_HUB_REVISION = previous;
		}
	});
});
