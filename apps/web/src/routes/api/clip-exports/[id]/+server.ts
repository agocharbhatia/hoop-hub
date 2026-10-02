import { json } from '@sveltejs/kit';
import { getClipExportService } from '$lib/server/clip-exports/runtime';
import { RESEARCH_ID_PATTERN } from '$lib/server/research/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	if (!RESEARCH_ID_PATTERN.test(params.id)) return json({ error: 'Invalid export ID.' }, { status: 400 });
	const job = getClipExportService().get(params.id);
	return job ? json({ job }) : json({ error: 'Export was not found or has expired.' }, { status: 404 });
};

export const DELETE: RequestHandler = async ({ params }) => {
	if (!RESEARCH_ID_PATTERN.test(params.id)) return json({ error: 'Invalid export ID.' }, { status: 400 });
	return getClipExportService().cancel(params.id) ? json({ job: getClipExportService().get(params.id) }) : json({ error: 'No active export was found.' }, { status: 404 });
};
