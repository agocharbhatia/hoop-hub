import { json, redirect, type Handle } from '@sveltejs/kit';
import { AUTH_COOKIE, authenticate } from '$lib/server/beta/auth';
import { BetaError, getBetaConfig } from '$lib/server/beta/config';
import { LOCAL_PRINCIPAL, withPrincipal } from '$lib/server/beta/context';

const PUBLIC_ROUTES = new Set(['/login', '/api/auth/sign-in', '/api/auth/redeem', '/api/health', '/api/ready']);

/** One boundary applies authentication, CSRF and request-size limits to every research surface. */
export const handle: Handle = async ({ event, resolve }) => {
	const config = getBetaConfig();
	const path = event.url.pathname;
	const api = path.startsWith('/api/');
	const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(event.request.method);
	if (config.mode === 'local' && !['localhost', '127.0.0.1', '[::1]'].includes(event.url.hostname)) return json({ error: 'Local mode is available on loopback only.' }, { status: 403 });
	if (config.mode === 'invite' && path.startsWith('/dev/')) return new Response('Not found', { status: 404 });
	const user = config.mode === 'local' ? LOCAL_PRINCIPAL : authenticate(event.cookies.get(AUTH_COOKIE));
	event.locals.user = user;
	if (!user && !PUBLIC_ROUTES.has(path) && !path.startsWith('/_app/')) {
		if (api) return json({ error: 'Sign in to continue your research.', code: 'sign_in_required' }, { status: 401 });
		redirect(303, '/login');
	}
	if (mutating) {
		const origin = config.origin ?? event.url.origin;
		if (event.request.headers.get('origin') !== origin || event.request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Request origin is not allowed.' }, { status: 403 });
		try { event.request = await boundedRequest(event.request); }
		catch (error) { if (error instanceof BetaError) return json({ error: error.message }, { status: error.status }); throw error; }
	}
	const started = performance.now();
	const requestId = crypto.randomUUID();
	const response = await withPrincipal({ ...(user ?? LOCAL_PRINCIPAL), requestId }, () => resolve(event));
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'no-referrer');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	response.headers.set('X-Request-Id', requestId);
	if (!path.startsWith('/_app/')) response.headers.set('Cache-Control', 'private, no-store');
	if (config.mode === 'invite' && api && path !== '/api/health' && path !== '/api/ready') {
		// Logs contain neither prompts, identities, session tokens nor arbitrary error text.
		console.info(JSON.stringify({ event: 'request', requestId, route: event.route.id, status: response.status, durationMs: Math.round(performance.now() - started) }));
	}
	return response;
};

/* Request helpers */
async function boundedRequest(request: Request): Promise<Request> {
	const limit = 16_384;
	if (Number(request.headers.get('content-length') ?? 0) > limit) throw new BetaError('Request body is too large.', 413);
	const reader = request.body?.getReader();
	if (!reader) return request;
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			bytes += next.value.byteLength;
			if (bytes > limit) { await reader.cancel(); throw new BetaError('Request body is too large.', 413); }
			chunks.push(next.value);
		}
	} finally { reader.releaseLock(); }
	const body = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
	return new Request(request.url, { method: request.method, headers: request.headers, body, signal: request.signal });
}
/* End request helpers */
