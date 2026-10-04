import { authenticateRequest } from '$lib/server/beta/auth-route';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = (event) => authenticateRequest(event, 'sign-in');
