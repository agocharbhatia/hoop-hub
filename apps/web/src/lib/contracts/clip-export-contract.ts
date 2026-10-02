export type ClipExportRequest = {
	sessionId: string;
	turnId: string;
	artifactIndex: number;
	eventIds?: Array<{ gameId: string; eventId: string }>;
};
export type ClipExportJob = {
	id: string;
	status: 'queued' | 'running' | 'completed' | 'failed';
	completedClips: number;
	totalClips: number;
	createdAt: string;
	updatedAt: string;
	downloadUrl?: string;
	expiresAt?: string;
	error?: string;
	omissions?: Array<{ gameId: string; eventId: string; reason: string }>;
};
export type ClipExportResponse = { job: ClipExportJob };
export const MAX_EXPORT_CLIPS = 40;
export const CLIP_EXPORT_RETENTION_HOURS = 24;
