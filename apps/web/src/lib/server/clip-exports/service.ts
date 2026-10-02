import { createHash } from 'node:crypto';
import { existsSync, rmSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { CLIP_EXPORT_RETENTION_HOURS, MAX_EXPORT_CLIPS, type ClipExportJob, type ClipExportRequest } from '$lib/contracts/clip-export-contract';
import { getDataStore, type DataStore } from '$lib/server/data/store/data-store';
import { RESEARCH_ID_PATTERN, researchRepository, type ResearchRepository } from '$lib/server/research/repository';
import { compilePlaylist, isCanonicalExportClip, type CompilePlaylistInput, type ExportClip } from './media-compiler';

type StoredExport = { job: ClipExportJob; requestKey: string; outputPath: string };
export class ClipExportError extends Error {
	constructor(message: string, readonly status = 400) { super(message); this.name = 'ClipExportError'; }
}

/** The client selects saved events, never download URLs or FFmpeg arguments. */
export function createClipExportService(options: { repository?: ResearchRepository; store?: DataStore | (() => DataStore); outputDir?: string; nowMs?: () => number; compile?: (input: CompilePlaylistInput) => Promise<void> } = {}) {
	const repository = options.repository ?? researchRepository;
	const store = () => typeof options.store === 'function' ? options.store() : options.store ?? getDataStore();
	const nowMs = options.nowMs ?? Date.now;
	const outputDir = options.outputDir ?? process.env.HOOP_HUB_EXPORT_DIR ?? resolve(homedir(), '.hoop-hub', 'exports', createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12));
	const compile = options.compile ?? compilePlaylist;
	const queue: Array<{ record: StoredExport; clips: ExportClip[] }> = [];
	const active = new Map<string, AbortController>();
	let running = false;
	const timestamp = () => new Date(nowMs()).toISOString();
	const write = (record: StoredExport) => store().putClipExportJob(record.job.id, JSON.stringify(record), record.job.updatedAt);
	function prune() {
		const records = store().listClipExportJobs().map((entry) => JSON.parse(entry.recordJson) as StoredExport).sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt));
		let retainedBytes = 0;
		for (const [index, record] of records.entries()) {
			const isActive = active.has(record.job.id) || queue.some((entry) => entry.record.job.id === record.job.id);
			if (isActive) continue;
			retainedBytes += existsSync(record.outputPath) ? statSync(record.outputPath).size : 0;
			if (index >= 20 || (record.job.expiresAt && Date.parse(record.job.expiresAt) <= nowMs()) || retainedBytes > 1_073_741_824) {
				rmSync(join(outputDir, record.job.id), { recursive: true, force: true }); store().deleteClipExportJob(record.job.id);
			}
		}
	}
	function read(id: string): StoredExport | null {
		const json = store().getClipExportJob(id);
		if (!json) return null;
		const record = JSON.parse(json) as StoredExport;
		if (record.job.expiresAt && Date.parse(record.job.expiresAt) <= nowMs()) { prune(); return null; }
		if (['queued', 'running'].includes(record.job.status) && !active.has(id) && !queue.some((entry) => entry.record.job.id === id)) {
			record.job = { ...record.job, status: 'failed', error: 'The server restarted before this export finished. Start the export again.', updatedAt: timestamp() }; write(record);
		}
		return record;
	}
	async function runNext(): Promise<void> {
		if (running) return;
		const pending = queue.shift();
		if (!pending) return;
		running = true;
		const { record, clips } = pending;
		const controller = new AbortController(); active.set(record.job.id, controller);
		record.job.status = 'running'; record.job.updatedAt = timestamp(); write(record);
		try {
			await mkdir(join(outputDir, record.job.id), { recursive: true });
			await compile({ clips, outputPath: record.outputPath, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]),
				onClipCompleted() { record.job.completedClips += 1; record.job.updatedAt = timestamp(); write(record); },
				onOmission(clip, reason) { (record.job.omissions ??= []).push({ gameId: clip.gameId, eventId: clip.eventId, reason }); record.job.updatedAt = timestamp(); write(record); }
			});
			if (controller.signal.aborted) throw new Error('Export was cancelled.');
			if (!existsSync(record.outputPath) || statSync(record.outputPath).size > 536_870_912) throw new Error('The compiled export exceeds its size limit.');
			record.job.status = 'completed'; record.job.downloadUrl = `/api/clip-exports/${record.job.id}/download`;
			record.job.expiresAt = new Date(nowMs() + CLIP_EXPORT_RETENTION_HOURS * 3_600_000).toISOString();
		} catch (error) {
			record.job.status = 'failed'; record.job.error = error instanceof Error ? error.message : 'Highlight compilation failed.';
			rmSync(join(outputDir, record.job.id), { recursive: true, force: true });
		} finally {
			record.job.updatedAt = timestamp(); write(record); active.delete(record.job.id); running = false;
			void runNext();
		}
	}
	return {
		create(request: ClipExportRequest): ClipExportJob {
			prune();
			const turn = repository.getTurn(request.sessionId, request.turnId);
			if (!turn) throw new ClipExportError('Saved research turn was not found.', 404);
			const artifact = turn.response.artifacts[request.artifactIndex];
			if (artifact?.type !== 'video_playlist' || artifact.source?.toolName !== 'find_video_clips') throw new ClipExportError('Select a saved, verified video playlist.');
			const selected = request.eventIds ? new Set(request.eventIds.map((event) => `${event.gameId}:${event.eventId}`)) : null;
			const clips = artifact.clips.filter((clip) => !selected || selected.has(`${clip.gameId}:${clip.eventId}`));
			if (selected && clips.length !== selected.size) throw new ClipExportError('Every selected event must belong to this saved playlist.');
			if (!clips.length || clips.length > MAX_EXPORT_CLIPS) throw new ClipExportError(`Select 1 to ${MAX_EXPORT_CLIPS} available clips.`);
			if (clips.some((clip) => !isCanonicalExportClip(clip))) throw new ClipExportError('One or more clips lack verified NBA media provenance.');
			const requestKey = createHash('sha256').update(JSON.stringify([request.sessionId, request.turnId, request.artifactIndex, clips.map((clip) => [clip.gameId, clip.eventId])])).digest('hex');
			for (const entry of store().listClipExportJobs()) {
				const existing = read(entry.jobId);
				if (existing?.requestKey === requestKey && existing.job.status !== 'failed') return structuredClone(existing.job);
			}
			if (queue.length >= 10) throw new ClipExportError('The export queue is full. Try again after a current export finishes.', 429);
			const id = crypto.randomUUID();
			const record: StoredExport = { requestKey, outputPath: join(outputDir, id, 'highlights.mp4'), job: { id, status: 'queued', completedClips: 0, totalClips: clips.length, createdAt: timestamp(), updatedAt: timestamp(), expiresAt: new Date(nowMs() + CLIP_EXPORT_RETENTION_HOURS * 3_600_000).toISOString() } };
			queue.push({ record, clips: clips as ExportClip[] }); write(record);
			queueMicrotask(() => { void runNext(); });
			return structuredClone(record.job);
		},
		get(id: string): ClipExportJob | null { const record = read(id); return record ? structuredClone(record.job) : null; },
		getDownload(id: string): { path: string; filename: string; size: number } | null {
			const record = read(id);
			return record?.job.status === 'completed' && existsSync(record.outputPath) ? { path: record.outputPath, filename: `hoop-hub-highlights-${id}.mp4`, size: statSync(record.outputPath).size } : null;
		},
		cancel(id: string): boolean {
			const record = read(id);
			if (!record || !['queued', 'running'].includes(record.job.status)) return false;
			const index = queue.findIndex((entry) => entry.record.job.id === id);
			if (index >= 0) queue.splice(index, 1);
			active.get(id)?.abort();
			record.job.status = 'failed'; record.job.error = 'Export was cancelled.'; record.job.updatedAt = timestamp(); write(record);
			return true;
		}
	};
}

export type ClipExportService = ReturnType<typeof createClipExportService>;
export const clipExportService = createClipExportService();

/* Request validation helpers */

export function validateClipExportRequest(value: unknown): ClipExportRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ClipExportError('Request body must be an object.');
	const input = value as Record<string, unknown>;
	if (Object.keys(input).some((key) => !['sessionId', 'turnId', 'artifactIndex', 'eventIds'].includes(key)) || typeof input.sessionId !== 'string' || !RESEARCH_ID_PATTERN.test(input.sessionId) ||
		typeof input.turnId !== 'string' || !RESEARCH_ID_PATTERN.test(input.turnId) || !Number.isSafeInteger(input.artifactIndex) || Number(input.artifactIndex) < 0 || Number(input.artifactIndex) > 100) throw new ClipExportError('Provide valid saved research, turn, and artifact IDs.');
	if (input.eventIds !== undefined && (!Array.isArray(input.eventIds) || input.eventIds.length < 1 || input.eventIds.length > MAX_EXPORT_CLIPS || input.eventIds.some((event) => !event || typeof event !== 'object' || Array.isArray(event) ||
		Object.keys(event).some((key) => !['gameId', 'eventId'].includes(key)) || typeof event.gameId !== 'string' || !/^\d{10}$/.test(event.gameId) || typeof event.eventId !== 'string' || !/^\d+$/.test(event.eventId)))) throw new ClipExportError('eventIds must contain 1 to 40 canonical game/event pairs.');
	return input as ClipExportRequest;
}

/* End request validation helpers */
