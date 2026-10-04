import { json } from '@sveltejs/kit';
import { isVideoAvailabilityRequest, videoAvailabilityService } from '$lib/server/video/availability';
import type { RequestHandler } from './$types';

let service = videoAvailabilityService;
export function _setVideoAvailabilityServiceForTests(value: typeof service | null): void { service = value ?? videoAvailabilityService; }

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Sign in to check this clip.' }, { status: 401 });
	let body: unknown;
	try {
		const source = await request.text();
		if (Buffer.byteLength(source) > 2_048) return json({ error: 'Request body is too large.' }, { status: 413 });
		body = JSON.parse(source);
	} catch { return json({ error: 'Invalid JSON body.' }, { status: 400 }); }
	if (!isVideoAvailabilityRequest(body)) return json({ error: 'A canonical NBA clip and matching event IDs are required.' }, { status: 400 });
	try { return json(await service.check(body, request.signal)); }
	catch { return json({ status: 'unknown', reason: 'check_failed' }); }
};
