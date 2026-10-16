import { json } from '@sveltejs/kit';
import { BoardError } from './boards';

/** Keep validation and ownership failures consistent across the board's small mutation surface. */
export async function boardResponse(work: () => unknown | Promise<unknown>): Promise<Response> {
	try { return json(await work()); }
	catch (error) { if (error instanceof BoardError) return json({ error: error.message }, { status: error.status }); throw error; }
}

export async function boardBody(request: Request, keys: string[]): Promise<Record<string, unknown>> {
	let body: unknown;
	try { body = await request.json(); } catch { throw new BoardError('Invalid JSON body.'); }
	if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key))) throw new BoardError('Invalid board request.');
	return body as Record<string, unknown>;
}
