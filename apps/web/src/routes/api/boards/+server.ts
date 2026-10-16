import { boardRepository } from '$lib/server/research/boards';
import { boardBody, boardResponse } from '$lib/server/research/board-http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => boardResponse(() => ({ boards: boardRepository.list() }));
export const POST: RequestHandler = ({ request }) => boardResponse(async () => { const body = await boardBody(request, ['title']); return boardRepository.create(body.title as string); });
