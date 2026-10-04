import { json } from '@sveltejs/kit';
import { BetaError } from '$lib/server/beta/config';
import { saveFeedback } from '$lib/server/beta/feedback';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	try { return json(saveFeedback(await request.json()), { status: 201 }); }
	catch (error) {
		if (error instanceof BetaError) return json({ error: error.message }, { status: error.status });
		if (error instanceof SyntaxError) return json({ error: 'Invalid request.' }, { status: 400 });
		console.error('Feedback could not be saved.');
		return json({ error: 'Feedback could not be saved. Please retry.' }, { status: 503 });
	}
};
