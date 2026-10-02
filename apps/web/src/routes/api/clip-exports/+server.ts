import { json } from '@sveltejs/kit';
import { getClipExportService } from '$lib/server/clip-exports/runtime';
import { ClipExportError, validateClipExportRequest } from '$lib/server/clip-exports/service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let value: unknown;
	try { const source = await request.text(); if (Buffer.byteLength(source) > 16_384) return json({ error: 'Request body is too large.' }, { status: 413 }); value = JSON.parse(source); }
	catch { return json({ error: 'Invalid JSON body.' }, { status: 400 }); }
	try { return json({ job: getClipExportService().create(validateClipExportRequest(value)) }, { status: 202 }); }
	catch (error) {
		if (error instanceof ClipExportError) return json({ error: error.message }, { status: error.status });
		return json({ error: 'The highlight export could not be started.' }, { status: 500 });
	}
};
