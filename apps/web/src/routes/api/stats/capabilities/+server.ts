import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPublicSemanticCapabilities } from '$lib/server/semantic/capabilities';

export const GET: RequestHandler = () => {
	return json(getPublicSemanticCapabilities());
};
