import type { QueryAnswerArtifact } from './answer-response';
import type { Citation } from './chat';
import type { QueryEffectiveScope } from './query-context';
import type { ArtifactViewState } from './research-views';

export type ResearchBoardSummary = { id: string; title: string; createdAt: string; updatedAt: string; itemCount: number };
export type ResearchBoardItem = {
	id: string;
	createdAt: string;
	note: string;
	question?: string;
	artifact?: QueryAnswerArtifact;
	citations: Citation[];
	scope?: QueryEffectiveScope;
	view: ArtifactViewState;
	source?: { sessionId: string; turnId: string; artifactIndex: number };
};
export type ResearchBoard = ResearchBoardSummary & { items: ResearchBoardItem[] };
export type BoardPinRequest = { sessionId: string; turnId: string; artifactIndex: number; view?: ArtifactViewState };
