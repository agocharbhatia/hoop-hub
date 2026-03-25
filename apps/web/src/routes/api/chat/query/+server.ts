import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { executeChatSemanticQuery, validateChatSemanticQueryRequest } from '$lib/server/semantic/query-service';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}

	const parsed = validateChatSemanticQueryRequest(body);
	if (!parsed.ok) {
		return json({ error: parsed.error }, { status: 400 });
	}

	try {
		const result = await executeChatSemanticQuery(parsed.value);
		return json(result, { status: 200 });
	} catch (error) {
		console.error('Unexpected query handler error:', error);
		return json({ error: 'Internal server error.' }, { status: 500 });
	}
};
