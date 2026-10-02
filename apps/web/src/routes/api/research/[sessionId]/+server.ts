import { json } from '@sveltejs/kit';
import { RESEARCH_ID_PATTERN, researchRepository, type ResearchRepository } from '$lib/server/research/repository';
import type { RequestHandler } from './$types';

let repository = researchRepository;
export function _setResearchDetailRepositoryForTests(value: ResearchRepository | null): void { repository = value ?? researchRepository; }

export const GET: RequestHandler = async ({ params }) => {
	if (!RESEARCH_ID_PATTERN.test(params.sessionId)) return json({ error: 'Invalid research ID.' }, { status: 400 });
	const result = repository.get(params.sessionId);
	return result ? json(result) : json({ error: 'Saved research was not found.' }, { status: 404 });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	if (!RESEARCH_ID_PATTERN.test(params.sessionId)) return json({ error: 'Invalid research ID.' }, { status: 400 });
	let body: unknown;
	try { const source = await request.text(); if (Buffer.byteLength(source) > 2048) return json({ error: 'Request body is too large.' }, { status: 413 }); body = JSON.parse(source); }
	catch { return json({ error: 'Invalid JSON body.' }, { status: 400 }); }
	if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'title') ||
		!('title' in body) || typeof body.title !== 'string' || body.title.trim().length < 1 || body.title.trim().length > 100) return json({ error: 'title must contain 1 to 100 characters.' }, { status: 400 });
	return repository.rename(params.sessionId, body.title) ? json(repository.get(params.sessionId)) : json({ error: 'Saved research was not found.' }, { status: 404 });
};

export const DELETE: RequestHandler = async ({ params }) => {
	if (!RESEARCH_ID_PATTERN.test(params.sessionId)) return json({ error: 'Invalid research ID.' }, { status: 400 });
	if (!repository.get(params.sessionId)) return json({ error: 'Saved research was not found.' }, { status: 404 });
	repository.delete(params.sessionId);
	return new Response(null, { status: 204 });
};
