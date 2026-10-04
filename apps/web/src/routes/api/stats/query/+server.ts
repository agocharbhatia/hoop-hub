import { admitResearch } from '$lib/server/beta/limits';
import { BetaError } from '$lib/server/beta/config';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { executeSemanticQuery, validateSemanticQueryRequest } from '$lib/server/semantic/query-service';

let testNow: Date | undefined;

/** Pins dated NBA fixtures without changing the production route's current-date behavior. */
export function _setStatsQueryNowForTests(now: Date | null): void {
	testNow = now ?? undefined;
}

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
		const admission = admitResearch();
		let result;
		try { result = await admission.run(() => executeSemanticQuery(parsed.value, testNow)); } finally { admission.release(); }
		return json(result, { status: 200 });
	} catch (error) {
		if (error instanceof BetaError) return json({ error: error.message, code: error.code }, { status: error.status, headers: error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {} });
		console.error('Unexpected semantic query handler error.');
		return json({ error: 'Internal server error.' }, { status: 500 });
	}
};
