import { error } from '@sveltejs/kit';
import { boardRepository, BoardError } from '$lib/server/research/boards';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	try { const id = url.searchParams.get('board'); return { boards: boardRepository.list(), board: id ? boardRepository.get(id) : null }; }
	catch (cause) { if (cause instanceof BoardError) error(cause.status, cause.message); throw cause; }
};
