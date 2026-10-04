import { spawn } from 'node:child_process';
import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
import { classifyNbaMediaResponse } from '$lib/server/video/availability';
import { isCanonicalNbaVideo } from '$lib/server/video/provenance';
import { buildNbaMediaRequestHeaders } from '$lib/server/video/media-request';

export type ExportClip = Extract<QueryAnswerArtifact, { type: 'video_playlist' }>['clips'][number] & { gameId: string; eventId: string };
export const MAX_CLIP_BYTES = 67_108_864;
export const MAX_EXPORT_SOURCE_BYTES = 536_870_912;

/** Revalidates canonical NBA media provenance before any server-side fetch, including redirects. */
export function isCanonicalExportClip(clip: { url: string; gameId?: string | null; eventId?: string | null }): boolean {
	return isCanonicalNbaVideo(clip);
}

export type CompilePlaylistInput = {
	clips: ExportClip[];
	outputPath: string;
	signal: AbortSignal;
	onClipCompleted: () => void;
	onOmission: (clip: ExportClip, reason: string) => void;
};

/** Normalizing each source avoids broken concatenations when NBA clips have different codecs or audio tracks. */
export async function compilePlaylist(input: CompilePlaylistInput, options: { ffmpegPath?: string; ffprobePath?: string; fetchImpl?: typeof fetch; mediaOrigin?: string } = {}): Promise<void> {
	const directory = join(dirname(input.outputPath), 'working');
	await mkdir(directory, { recursive: true });
	const compiled: string[] = [];
	let sourceBytes = 0;
	try {
		for (const [index, clip] of input.clips.entries()) {
			input.signal.throwIfAborted();
			const sourcePath = join(directory, `source-${index}.mp4`);
			const normalizedName = `clip-${index}.mp4`;
			const normalizedPath = join(directory, normalizedName);
			try {
				await downloadClip(clip, sourcePath, MAX_EXPORT_SOURCE_BYTES - sourceBytes, input.signal, options.fetchImpl ?? fetch, (bytes) => { sourceBytes += bytes; }, options.mediaOrigin);
				const metadata = JSON.parse(await runMediaProcess(options.ffprobePath ?? process.env.HOOP_HUB_FFPROBE_PATH ?? 'ffprobe',
					['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', sourcePath], input.signal, 30_000));
				const duration = Number(metadata.format?.duration);
				if (!Number.isFinite(duration) || duration <= 0 || duration > 90 || !metadata.streams?.some((stream: { codec_type: string }) => stream.codec_type === 'video')) throw new Error('The source is not a supported clip (maximum 90 seconds).');
				const hasAudio = metadata.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio');
				const args = ['-y', '-v', 'error', '-i', sourcePath,
					...(!hasAudio ? ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'] : []),
					'-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0',
					'-vf', 'scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30',
					'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-shortest', '-movflags', '+faststart', normalizedPath];
				await runMediaProcess(options.ffmpegPath ?? process.env.HOOP_HUB_FFMPEG_PATH ?? 'ffmpeg', args, input.signal, 180_000);
				compiled.push(normalizedName);
				input.onClipCompleted();
			} catch (error) {
				if (input.signal.aborted) throw error;
				input.onOmission(clip, error instanceof Error ? error.message : 'Clip could not be compiled.');
			} finally { await rm(sourcePath, { force: true }); }
		}
		if (!compiled.length) throw new Error('None of the selected source clips could be compiled.');
		await writeFile(join(directory, 'playlist.txt'), compiled.map((name) => `file '${name}'`).join('\n'));
		await runMediaProcess(options.ffmpegPath ?? process.env.HOOP_HUB_FFMPEG_PATH ?? 'ffmpeg',
			['-y', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', join(directory, 'playlist.txt'), '-c', 'copy', '-movflags', '+faststart', input.outputPath], input.signal, 60_000);
	} finally { await rm(directory, { recursive: true, force: true }); }
}

/* Bounded media I/O helpers */

async function downloadClip(clip: ExportClip, destination: string, remainingBytes: number, signal: AbortSignal, fetchImpl: typeof fetch, onBytes: (bytes: number) => void, mediaOrigin?: string): Promise<number> {
	if (!isCanonicalExportClip(clip)) throw new Error('Clip media provenance is not verified.');
	let url = clip.url;
	let response: Response | undefined;
	const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
	for (let redirects = 0; redirects <= 3; redirects += 1) {
		response = await fetchImpl(url, { method: 'GET', headers: buildNbaMediaRequestHeaders({ origin: mediaOrigin }), redirect: 'manual', signal: downloadSignal });
		if (![301, 302, 303, 307, 308].includes(response.status)) break;
		const location = response.headers.get('location');
		await response.body?.cancel();
		if (!location) throw new Error('Clip source returned an invalid redirect.');
		url = new URL(location, url).href;
		if (!isCanonicalExportClip({ ...clip, url })) throw new Error('Clip source redirected outside verified NBA media.');
	}
	if (!response?.ok || !response.body) throw new Error(`Clip source is unavailable (HTTP ${response?.status ?? 'error'}).`);
	if (classifyNbaMediaResponse(response).reason === 'nba_unavailable') {
		await response.body.cancel();
		throw new Error('NBA is serving an unavailable-video placeholder for this event.');
	}
	const allowedBytes = Math.min(MAX_CLIP_BYTES, remainingBytes);
	if (allowedBytes <= 0 || Number(response.headers.get('content-length') ?? 0) > allowedBytes) { await response.body.cancel(); throw new Error('Clip exceeds the export download limit.'); }
	const file = await open(destination, 'w');
	let bytes = 0;
	try {
		for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
			downloadSignal.throwIfAborted(); bytes += chunk.byteLength; onBytes(chunk.byteLength);
			if (bytes > allowedBytes) throw new Error('Clip exceeds the export download limit.');
			await file.write(chunk);
		}
	} finally { await file.close(); }
	return bytes;
}

export function runMediaProcess(command: string, args: string[], signal: AbortSignal, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
		let output = ''; let errorOutput = ''; let timedOut = false;
		const kill = () => child.kill('SIGKILL');
		const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
		signal.addEventListener('abort', kill, { once: true });
		if (signal.aborted) kill();
		child.stdout.on('data', (chunk) => { output = (output + String(chunk)).slice(-65_536); });
		child.stderr.on('data', (chunk) => { errorOutput = (errorOutput + String(chunk)).slice(-4096); });
		const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', kill); };
		child.once('error', (error) => { cleanup(); reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('FFmpeg and FFprobe must be installed to compile highlights.') : error); });
		child.once('close', (code) => {
			cleanup();
			if (signal.aborted) reject(new Error('Export was cancelled.'));
			else if (timedOut) reject(new Error('Video compilation exceeded its time limit.'));
			else if (code !== 0) reject(new Error(errorOutput.trim() ? 'The source clip could not be decoded or compiled.' : 'Video compilation failed.'));
			else resolve(output);
		});
	});
}

/* End bounded media I/O helpers */
