import { AUTH_COOKIE, signOut } from '$lib/server/beta/auth';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = ({ cookies }) => {
	signOut(cookies.get(AUTH_COOKIE));
	cookies.delete(AUTH_COOKIE, { path: '/' });
	return new Response(null, { status: 204 });
};
