import type { QueryAnswerArtifact, QueryAnswerResponse } from './answer-response';

export type QueryProgress = {
	stage: 'planning' | 'resolving' | 'fetching' | 'computing' | 'writing';
	message: string;
	completedTools: number;
	elapsedMs: number;
};

/** Artifact events replace the full provisional snapshot; only verified source results belong here. */
export type QueryStreamEvent =
	| { event: 'progress'; data: QueryProgress }
	| { event: 'artifacts'; data: { artifacts: QueryAnswerArtifact[] } }
	| { event: 'result'; data: QueryAnswerResponse }
	| { event: 'error'; data: { message: string; code?: string } };
