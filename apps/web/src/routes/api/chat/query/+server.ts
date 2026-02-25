import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	isQueryEngineInvariantError,
	runMockQuery,
	validateChatQueryRequest
} from '$lib/server/mock/query-engine';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}

	const parsed = validateChatQueryRequest(body);
	if (!parsed.ok) {
		return json({ error: parsed.error }, { status: 400 });
	}

	try {
		const result = runMockQuery(parsed.value);
		return json(result, { status: 200 });
	} catch (error) {
		if (isQueryEngineInvariantError(error)) {
			return json({ error: 'Internal query planning error.' }, { status: 500 });
		}
		console.error('Unexpected query handler error:', error);
		return json({ error: 'Internal server error.' }, { status: 500 });
	}
};
