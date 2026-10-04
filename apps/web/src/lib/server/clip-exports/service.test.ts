import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import type { QueryAnswerArtifact, QueryAnswerResponse } from '$lib/contracts/answer-response';
import { DataStore } from '$lib/server/data/store/data-store';
import { createResearchRepository } from '$lib/server/research/repository';
import { compilePlaylist, isCanonicalExportClip, runMediaProcess, type ExportClip } from './media-compiler';
import { createClipExportService, validateClipExportRequest, type ClipExportService } from './service';

/* Export fixture helpers */

const clips: ExportClip[] = [34, 171].map((eventId) => ({ gameId: '0022400449', eventId: String(eventId), gameDate: '2024-12-31', thumbnailUrl: null, description: 'Barnes shot', url: `https://videos.nba.com/nba/pbp/media/2024/12/31/0022400449/${eventId}/clip.mp4` }));
function savePlaylist(repository: ReturnType<typeof createResearchRepository>, source = true) {
	const sessionId = crypto.randomUUID();
	const artifact: QueryAnswerArtifact = { type: 'video_playlist', title: 'Verified highlights', clips, ...(source ? { source: { toolName: 'find_video_clips', endpointId: 'videodetailsasset', resultSetName: 'playlist', request: {} } as const } : {}) };
	const response: QueryAnswerResponse = { answer: 'Highlights', status: 'ok', artifacts: [artifact], toolResults: [], citations: [], warnings: [], traceId: 'trace-export' };
	const saved = repository.saveResult(sessionId, { question: 'Show highlights.', response })!;
	return { sessionId, turnId: saved.turnId, artifactIndex: 0 };
}
async function finish(service: ClipExportService, id: string) {
	for (let attempt = 0; attempt < 100; attempt++) {
		const job = service.get(id)!;
		if (job.status === 'completed' || job.status === 'failed') return job;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.fail('Export did not finish');
}

/* End export fixture helpers */

test('exports only stored grounded selections, deduplicates jobs, persists completion, and expires downloads', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'hoop-export-')); const store = new DataStore({ dbPath: ':memory:' }); let now = 1_000;
	try {
		const repository = createResearchRepository({ store }); const request = savePlaylist(repository);
		let compiled = 0;
		const service = createClipExportService({ repository, store, outputDir: directory, nowMs: () => now, compile: async (input) => {
			compiled++; for (const _clip of input.clips) input.onClipCompleted(); await writeFile(input.outputPath, 'compiled-video');
		} });
		const job = service.create(request); assert.equal(job.status, 'queued'); assert.equal(service.create(request).id, job.id);
		const completed = await finish(service, job.id); assert.equal(completed.status, 'completed'); assert.equal(completed.completedClips, 2); assert.equal(compiled, 1);
		assert.ok(completed.downloadUrl); assert.ok(service.getDownload(job.id));
		const reopened = createClipExportService({ repository, store, outputDir: directory, nowMs: () => now });
		assert.equal(reopened.get(job.id)?.status, 'completed');
		assert.throws(() => service.create({ ...request, eventIds: [{ gameId: '0022400449', eventId: '999' }] }), /belong/);
		assert.throws(() => service.create(savePlaylist(repository, false)), /verified/);
		now += 25 * 3_600_000; assert.equal(service.get(job.id), null); assert.equal(existsSync(join(directory, job.id)), false);
	} finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('partial exports report omitted source clips and cancellation stops an active job', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'hoop-export-')); const store = new DataStore({ dbPath: ':memory:' });
	try {
		const repository = createResearchRepository({ store }); const request = savePlaylist(repository);
		const partial = createClipExportService({ repository, store, outputDir: directory, compile: async (input) => { input.onClipCompleted(); input.onOmission(input.clips[1], 'Source unavailable.'); await writeFile(input.outputPath, 'video'); } });
		const job = await finish(partial, partial.create(request).id);
		assert.equal(job.status, 'completed'); assert.equal(job.completedClips, 1); assert.equal(job.omissions?.[0].eventId, '171');
		const cancel = createClipExportService({ repository, store, outputDir: directory, compile: async (input) => { await new Promise<void>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('Export was cancelled.')), { once: true })); } });
		const active = cancel.create(savePlaylist(repository)); await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(cancel.cancel(active.id), true); assert.equal((await finish(cancel, active.id)).status, 'failed');
		assert.match(cancel.get(active.id)?.error ?? '', /cancelled/);
		await new Promise((resolve) => setTimeout(resolve, 10));
	} finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('empty compiled output fails the job and never exposes a download', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'hoop-empty-export-')); const store = new DataStore({ dbPath: ':memory:' });
	try {
		const repository = createResearchRepository({ store });
		const service = createClipExportService({ repository, store, outputDir: directory, compile: async (input) => {
			input.onClipCompleted(); await writeFile(input.outputPath, new Uint8Array());
		} });
		const created = service.create(savePlaylist(repository));
		const result = await finish(service, created.id);
		assert.equal(result.status, 'failed'); assert.match(result.error ?? '', /empty/);
		assert.equal(result.downloadUrl, undefined); assert.equal(service.getDownload(created.id), null);
		assert.equal(existsSync(join(directory, created.id)), false);
	} finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('request and URL provenance validation excludes arbitrary server fetches', () => {
	for (const url of ['http://videos.nba.com/nba/pbp/media/2024/12/31/0022400449/34/clip.mp4', 'https://example.com/clip.mp4', 'https://videos.nba.com@127.0.0.1/clip.mp4', clips[1].url]) assert.equal(isCanonicalExportClip({ ...clips[0], url }), false);
	assert.equal(isCanonicalExportClip(clips[0]), true);
	assert.equal(isCanonicalExportClip({ url: 'https://videos.nba.com/clip.mp4' }), false);
	assert.throws(() => validateClipExportRequest({ sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(), artifactIndex: 0, url: clips[0].url }), /valid saved/);
	assert.throws(() => validateClipExportRequest({ sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(), artifactIndex: 0, eventIds: [{ gameId: 'x', eventId: '1' }] }), /canonical/);
});

test('clip download rejects redirects outside NBA provenance and oversized media before decoding', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'hoop-media-')); const signal = AbortSignal.timeout(10_000);
	try {
		for (const mode of ['redirect', 'oversized']) {
			const omissions: string[] = [];
			await assert.rejects(() => compilePlaylist({ clips: [clips[0]], outputPath: join(directory, 'result.mp4'), signal,
				onClipCompleted: () => assert.fail('Unverified media was compiled'), onOmission: (_clip, reason) => omissions.push(reason)
			}, { fetchImpl: (async () => mode === 'redirect' ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }) : new Response('media', { headers: { 'content-length': String(67_108_865) } })) as typeof fetch }), /None of the selected/);
			assert.match(omissions[0], mode === 'redirect' ? /outside verified/ : /download limit/);
		}
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

test('exports omit the NBA HTTP 200 unavailable slate before downloading or decoding it', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'hoop-slate-export-')); let cancelled = false; let calls = 0;
	try {
		const omissions: string[] = [];
		await assert.rejects(() => compilePlaylist({ clips: [clips[0]], outputPath: join(directory, 'result.mp4'), signal: AbortSignal.timeout(10_000),
			onClipCompleted: () => assert.fail('Unavailable footage was compiled'), onOmission: (_clip, reason) => omissions.push(reason)
		}, { fetchImpl: (async () => { calls++; return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: {
			'content-type': 'video/mp4', 'content-length': '31580089', etag: '"2dd8e05a98fc6949fa7ec979b0905464:1754501139.183376"'
		} }); }) as typeof fetch }), /None of the selected/);
		assert.equal(calls, 1); assert.equal(cancelled, true); assert.match(omissions[0], /unavailable-video placeholder/);
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

test('FFmpeg compiles normalized audio and silent clips into one playable MP4', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 || spawnSync('ffprobe', ['-version']).status !== 0 }, async () => {
	const directory = mkdtempSync(join(tmpdir(), 'hoop-media-')); const signal = AbortSignal.timeout(30_000);
	try {
		const source = join(directory, 'input.mp4');
		await runMediaProcess('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], signal, 10_000);
		const bytes = readFileSync(source); let completed = 0; const omissions: string[] = [];
		const output = join(directory, 'highlights.mp4');
		await compilePlaylist({ clips, outputPath: output, signal, onClipCompleted: () => { completed++; }, onOmission: (_clip, reason) => omissions.push(reason) }, { fetchImpl: (async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } })) as typeof fetch });
		const probe = JSON.parse(await runMediaProcess('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', output], signal, 10_000));
		assert.equal(completed, 2); assert.deepEqual(omissions, []); assert.ok(Number(probe.format.duration) >= 0.9);
		assert.equal(probe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video').width, 854);
		assert.ok(probe.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio'));
	} finally { rmSync(directory, { recursive: true, force: true }); }
});
