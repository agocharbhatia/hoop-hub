import { boardRepository } from '$lib/server/research/boards';
import { boardBody, boardResponse } from '$lib/server/research/board-http';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = ({ params, request }) => boardResponse(async () => { const body = await boardBody(request, ['note']); return boardRepository.updateNote(params.boardId, params.itemId, body.note as string); });
export const DELETE: RequestHandler = ({ params }) => boardResponse(() => boardRepository.removeItem(params.boardId, params.itemId));
