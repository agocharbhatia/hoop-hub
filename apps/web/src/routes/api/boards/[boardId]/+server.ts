import { BoardError, boardRepository } from '$lib/server/research/boards';
import { boardBody, boardResponse } from '$lib/server/research/board-http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => boardResponse(() => boardRepository.get(params.boardId));
export const PATCH: RequestHandler = ({ params, request }) => boardResponse(async () => {
	const body = await boardBody(request, ['title', 'itemIds']);
	if ('title' in body && !('itemIds' in body)) return boardRepository.rename(params.boardId, body.title as string);
	if ('itemIds' in body && !('title' in body)) return boardRepository.reorder(params.boardId, body.itemIds as string[]);
	throw new BoardError('Choose a title change or a finding order.');
});
export const DELETE: RequestHandler = ({ params }) => boardResponse(() => { boardRepository.delete(params.boardId); return { deleted: true }; });
