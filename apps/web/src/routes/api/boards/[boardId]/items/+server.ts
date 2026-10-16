import type { BoardPinRequest } from '$lib/contracts/research-board';
import { BoardError, boardRepository } from '$lib/server/research/boards';
import { boardBody, boardResponse } from '$lib/server/research/board-http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ params, request }) => boardResponse(async () => {
	const body = await boardBody(request, ['sessionId', 'turnId', 'artifactIndex', 'view', 'note']);
	if ('note' in body) { if (Object.keys(body).length !== 1) throw new BoardError('Use a separate request for notes.'); return boardRepository.addNote(params.boardId, body.note as string); }
	return boardRepository.pin(params.boardId, body as unknown as BoardPinRequest);
});
