import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { executeSemanticQuery, validateSemanticQueryRequest } from '$lib/server/semantic/query-service';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}

	const parsed = validateSemanticQueryRequest(body);
	if (!parsed.ok) {
		return json({ error: parsed.error }, { status: 400 });
	}

	try {
		const result = await executeSemanticQuery(parsed.value);
		return json(result, { status: 200 });
	} catch (error) {
		console.error('Unexpected semantic query handler error:', error);
		return json({ error: 'Internal server error.' }, { status: 500 });
	}
};
