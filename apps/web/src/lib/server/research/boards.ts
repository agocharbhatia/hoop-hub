import type { ResearchBoard, ResearchBoardItem, ResearchBoardSummary, BoardPinRequest } from '$lib/contracts/research-board';
import { validArtifactView } from '$lib/contracts/research-views';
import { currentOwnerId } from '$lib/server/beta/context';
import { getDataStore, type DataStore, type ResearchBoardRecord } from '$lib/server/data/store/data-store';
import { createResearchRepository, RESEARCH_ID_PATTERN, type ResearchRepository } from './repository';

export class BoardError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const MAX_ITEMS = 40, MAX_BOARDS = 30, MAX_ITEM_BYTES = 1_048_576, MAX_OWNER_BYTES = 16_777_216;

/** Pins are immutable copies of owned saved evidence, independent of later research expiry or deletion. */
export function createBoardRepository(options: { store?: DataStore | (() => DataStore); research?: ResearchRepository; ownerId?: string | (() => string); now?: () => string } = {}) {
	const store = () => typeof options.store === 'function' ? options.store() : options.store ?? getDataStore();
	const owner = () => typeof options.ownerId === 'function' ? options.ownerId() : options.ownerId ?? currentOwnerId();
	const research = options.research ?? createResearchRepository({ store, ownerId: owner });
	const now = options.now ?? (() => new Date().toISOString());
	const requireBoard = (id: string) => { const board = RESEARCH_ID_PATTERN.test(id) ? store().getResearchBoard(id, owner()) : null; if (!board) throw new BoardError('Research board was not found.', 404); return board; };
	const summary = (board: ResearchBoardRecord): ResearchBoardSummary => ({ id: board.id, title: board.title, createdAt: board.createdAt, updatedAt: board.updatedAt, itemCount: store().countResearchBoardItems(board.id) });
	const get = (id: string): ResearchBoard => ({ ...summary(requireBoard(id)), items: store().listResearchBoardItems(id).map(item => JSON.parse(item.snapshotJson) as ResearchBoardItem) });
	function saveItem(boardId: string, item: ResearchBoardItem, position: number) {
		const serialized = JSON.stringify(item);
		const previous = store().listResearchBoardItems(boardId).find(record => record.id === item.id);
		if (Buffer.byteLength(serialized) > MAX_ITEM_BYTES || store().researchBoardBytes(owner()) - Buffer.byteLength(previous?.snapshotJson ?? '') + Buffer.byteLength(serialized) > MAX_OWNER_BYTES) throw new BoardError('This board has reached its evidence storage limit.', 413);
		store().putResearchBoardItem({ id: item.id, boardId, position, snapshotJson: serialized, createdAt: item.createdAt });
		store().putResearchBoard({ ...requireBoard(boardId), updatedAt: now() });
	}
	return {
		list: () => store().listResearchBoards(owner()).map(summary), get,
		create(title: string): ResearchBoard {
			validateTitle(title);
			return store().withBoardTransaction(() => { if (store().listResearchBoards(owner()).length >= MAX_BOARDS) throw new BoardError('You can keep up to 30 research boards.', 409); const id = crypto.randomUUID(), timestamp = now(); store().putResearchBoard({ id, ownerId: owner(), title: title.trim(), createdAt: timestamp, updatedAt: timestamp }); return get(id); });
		},
		rename(id: string, title: string) { validateTitle(title); return store().withBoardTransaction(() => { store().putResearchBoard({ ...requireBoard(id), title: title.trim(), updatedAt: now() }); return get(id); }); },
		delete(id: string) { store().withBoardTransaction(() => { requireBoard(id); store().deleteResearchBoard(id, owner()); }); },
		pin(id: string, input: BoardPinRequest): ResearchBoard {
			if (!input || !RESEARCH_ID_PATTERN.test(input.sessionId) || !RESEARCH_ID_PATTERN.test(input.turnId) || !Number.isSafeInteger(input.artifactIndex) || input.artifactIndex < 0 || !validArtifactView(input.view ?? {})) throw new BoardError('Choose a saved research artifact to pin.');
			return store().withBoardTransaction(() => {
				const board = get(id);
				const turn = research.getTurn(input.sessionId, input.turnId);
				const artifact = turn?.response.artifacts[input.artifactIndex];
				if (!turn || !artifact || artifact.type === 'text_block') throw new BoardError('Saved evidence was not found.', 404);
				const source = { sessionId: input.sessionId, turnId: input.turnId, artifactIndex: input.artifactIndex };
				if (board.items.some(item => JSON.stringify(item.source) === JSON.stringify(source) && JSON.stringify(item.view) === JSON.stringify(input.view ?? {}))) return board;
				if (board.items.length >= MAX_ITEMS) throw new BoardError('A board can contain up to 40 findings.', 409);
				const item: ResearchBoardItem = { id: crypto.randomUUID(), createdAt: now(), note: '', question: turn.question, artifact: structuredClone(artifact), citations: structuredClone(turn.response.citations), ...(turn.response.effectiveScope ? { scope: structuredClone(turn.response.effectiveScope) } : {}), view: structuredClone(input.view ?? {}), source };
				saveItem(id, item, board.items.length); return get(id);
			});
		},
		addNote(id: string, note: string) { validateNote(note); return store().withBoardTransaction(() => { const board = get(id); if (board.items.length >= MAX_ITEMS) throw new BoardError('A board can contain up to 40 findings.', 409); saveItem(id, { id: crypto.randomUUID(), createdAt: now(), note: note.trim(), citations: [], view: {} }, board.items.length); return get(id); }); },
		updateNote(id: string, itemId: string, note: string) { validateNote(note); return store().withBoardTransaction(() => { const records = store().listResearchBoardItems(requireBoard(id).id); const record = records.find(item => item.id === itemId); if (!record) throw new BoardError('Finding was not found.', 404); const item = JSON.parse(record.snapshotJson) as ResearchBoardItem; saveItem(id, { ...item, note: note.trim() }, record.position); return get(id); }); },
		removeItem(id: string, itemId: string) { return store().withBoardTransaction(() => { requireBoard(id); store().deleteResearchBoardItem(id, itemId); store().putResearchBoard({ ...requireBoard(id), updatedAt: now() }); return get(id); }); },
		reorder(id: string, itemIds: string[]) { return store().withBoardTransaction(() => { const items = store().listResearchBoardItems(requireBoard(id).id); if (!Array.isArray(itemIds) || itemIds.length !== items.length || new Set(itemIds).size !== items.length || items.some(item => !itemIds.includes(item.id))) throw new BoardError('Include each finding once when ordering a board.'); for (const [position, itemId] of itemIds.entries()) store().putResearchBoardItem({ ...items.find(item => item.id === itemId)!, position }); store().putResearchBoard({ ...requireBoard(id), updatedAt: now() }); return get(id); }); }
	};
}

/* Board input helpers */

function validateTitle(title: string): void { if (typeof title !== 'string' || !title.trim() || title.trim().length > 100) throw new BoardError('Use a board title between 1 and 100 characters.'); }
function validateNote(note: string): void { if (typeof note !== 'string' || note.length > 5000) throw new BoardError('Notes can contain up to 5,000 characters.'); }

/* End board input helpers */

export type BoardRepository = ReturnType<typeof createBoardRepository>;
export const boardRepository = createBoardRepository();
