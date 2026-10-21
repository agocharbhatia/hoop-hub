import { json } from '@sveltejs/kit';
import { researchRepository, type ResearchRepository } from '$lib/server/research/repository';
import type { RequestHandler } from './$types';

let repository = researchRepository;
export function _setResearchRepositoryForTests(value: ResearchRepository | null): void { repository = value ?? researchRepository; }

export const GET: RequestHandler = async ({ url }) => {
	const limit = Number(url.searchParams.get('limit') ?? 20);
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) return json({ error: 'limit must be an integer from 1 to 50.' }, { status: 400 });
	const search = (url.searchParams.get('search') ?? '').trim();
	if (search.length > 100) return json({ error: 'Search can contain up to 100 characters.' }, { status: 400 });
	try { return json(repository.list(limit, url.searchParams.get('cursor') ?? undefined, search)); }
	catch { return json({ error: 'Invalid research cursor.' }, { status: 400 }); }
};
