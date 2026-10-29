import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	return json({
		status: 'ok',
		service: 'web',
		revision: process.env.HOOP_HUB_REVISION ?? 'unknown',
		timestamp: new Date().toISOString()
	});
};
