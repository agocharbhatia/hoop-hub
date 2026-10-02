import type { QueryAnswerResponse } from './answer-response';

/** Display history deliberately excludes raw endpoint payloads used only by the live query trace. */
export type SavedResearchResponse = Omit<QueryAnswerResponse, 'toolResults'>;
export type SavedResearchSummary = { sessionId: string; title: string; createdAt: string; updatedAt: string; turnCount: number };
export type SavedResearchTurn = { turnId: string; question: string; createdAt: string; response: SavedResearchResponse };
export type SavedResearchList = { sessions: SavedResearchSummary[]; nextCursor?: string };
export type SavedResearchDetail = { session: SavedResearchSummary; turns: SavedResearchTurn[] };

export const RESEARCH_RETENTION_DAYS = 90;

