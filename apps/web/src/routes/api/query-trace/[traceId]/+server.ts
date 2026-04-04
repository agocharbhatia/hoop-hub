import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getQueryTraceById } from '$lib/server/semantic/trace-store';

export const GET: RequestHandler = ({ params }) => {
	const traceId = params.traceId?.trim();
	if (!traceId) {
		return json({ error: 'traceId is required.' }, { status: 400 });
	}

	const trace = getQueryTraceById(traceId);
	if (!trace) {
		return json({ error: 'Trace not found.' }, { status: 404 });
	}

	return json(trace, { status: 200 });
};
