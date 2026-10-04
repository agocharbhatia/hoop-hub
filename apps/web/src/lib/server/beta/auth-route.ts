import { json, type RequestEvent } from '@sveltejs/kit';
import { AUTH_COOKIE, SESSION_SECONDS, redeemInvite, signIn, throttleLogin } from './auth';
import { BetaError, getBetaConfig } from './config';

/** Keeps credential endpoints consistent and never returns tokens in the JSON response. */
export async function authenticateRequest(event: RequestEvent, kind: 'sign-in' | 'redeem'): Promise<Response> {
	try {
		const input = await event.request.json() as Record<string, unknown>;
		if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BetaError('Provide your sign-in details.');
		throttleLogin(loginClientAddress(event), input.email);
		const result = kind === 'sign-in' ? await signIn(input.email, input.password) : await redeemInvite(input.token, input.password);
		event.cookies.set(AUTH_COOKIE, result.token, { path: '/', httpOnly: true, secure: event.url.protocol === 'https:', sameSite: 'lax', maxAge: SESSION_SECONDS });
		return json({ user: { name: result.principal.name, email: result.principal.email } });
	} catch (error) {
		if (error instanceof BetaError) return json({ error: error.message, code: error.code }, { status: error.status, ...(error.retryAfter ? { headers: { 'Retry-After': String(error.retryAfter) } } : {}) });
		if (error instanceof SyntaxError) return json({ error: 'Invalid request.' }, { status: 400 });
		console.error('Credential request failed.');
		return json({ error: 'Sign-in is temporarily unavailable.' }, { status: 503 });
	}
}

/* Credential transport helpers */
/** Local Docker checks bypass Caddy; public deployments must still supply its trusted address. */
export function loginClientAddress(event: Pick<RequestEvent, 'getClientAddress'>): string {
	try { return event.getClientAddress(); }
	catch (error) {
		const origin = getBetaConfig().origin;
		if (origin && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) return 'loopback-beta';
		throw error;
	}
}
/* End credential transport helpers */
