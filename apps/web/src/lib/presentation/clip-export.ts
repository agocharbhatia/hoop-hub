import { CLIP_EXPORT_RETENTION_HOURS, type ClipExportJob } from '$lib/contracts/clip-export-contract';

/** Reused exports keep their original deadline; older responses fall back to their last server update. */
export function getClipExportExpiry(job: Pick<ClipExportJob, 'expiresAt' | 'updatedAt'>): number | null {
	const explicit = Date.parse(job.expiresAt ?? '');
	if (Number.isFinite(explicit)) return explicit;
	const updated = Date.parse(job.updatedAt);
	return Number.isFinite(updated) ? updated + CLIP_EXPORT_RETENTION_HOURS * 3_600_000 : null;
}
