import type { VideoAvailability, VideoAvailabilityRequest } from '$lib/contracts/video-availability';
import { videoPlaybackUrl } from '$lib/contracts/video-media-url';
import { isCanonicalNbaVideo, verifiedNbaMediaRedirect } from './provenance';
import { buildNbaMediaRequestHeaders } from './media-request';

// Captured from the actual NBA unavailable slate on 2026-10-03 and visually verified at 2 seconds.
// Both fields must match; an HTTP 200 or a similar file size alone does not identify missing footage.
const UNAVAILABLE_SLATE_ETAG = '"2dd8e05a98fc6949fa7ec979b0905464:1754501139.183376"';
const UNAVAILABLE_SLATE_BYTES = '31580089';
const UNKNOWN: VideoAvailability = { status: 'unknown', reason: 'check_failed' };

/** Detects the known encoded error video without claiming that other HTTP 200 files contain real footage. */
export function classifyNbaMediaResponse(response: Response): VideoAvailability {
	if (response.ok && response.headers.get('etag') === UNAVAILABLE_SLATE_ETAG &&
		completeMediaBytes(response) === UNAVAILABLE_SLATE_BYTES &&
		response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() === 'video/mp4') {
		return { status: 'unavailable', reason: 'nba_unavailable' };
	}
	if (response.status === 429) {
		const seconds = Number(response.headers.get('retry-after'));
		return { status: 'unknown', reason: 'rate_limited', ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfterSeconds: Math.min(120, Math.ceil(seconds)) } : {}) };
	}
	if ([403, 404, 410].includes(response.status)) return { status: 'unavailable', reason: 'source_unavailable' };
	return response.ok ? { status: 'unknown', reason: 'unrecognized' } : UNKNOWN;
}

type ActiveCheck = { controller: AbortController; promise: Promise<VideoAvailability>; consumers: number; settled: boolean };

/** Checks only the selected official clip; bounded shared work keeps playlist navigation inexpensive. */
export function createVideoAvailabilityService(options: {
	fetchImpl?: typeof fetch; nowMs?: () => number; timeoutMs?: number; maxActive?: number; maxCache?: number;
	mediaOrigin?: string;
} = {}) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const nowMs = options.nowMs ?? Date.now;
	const cache = new Map<string, { value: VideoAvailability; expiresAt: number }>();
	const active = new Map<string, ActiveCheck>();
	const maxCache = Math.max(1, options.maxCache ?? 5_000);
	const maxActive = Math.max(1, options.maxActive ?? 8);
	async function check(clip: VideoAvailabilityRequest, signal?: AbortSignal): Promise<VideoAvailability> {
		if (!isVideoAvailabilityRequest(clip)) throw new Error('A canonical NBA clip and matching event IDs are required.');
		signal?.throwIfAborted();
		const cached = cache.get(clip.url);
		if (cached && cached.expiresAt > nowMs()) return { ...cached.value };
		cache.delete(clip.url);
		let job = active.get(clip.url);
		if (job?.controller.signal.aborted) { active.delete(clip.url); job = undefined; }
		if (!job) {
			if (active.size >= maxActive) return { ...UNKNOWN };
			const controller = new AbortController();
			job = { controller, promise: Promise.resolve(UNKNOWN), consumers: 0, settled: false };
			const current = job;
			active.set(clip.url, current);
			current.promise = probeClip(clip, fetchImpl, AbortSignal.any([controller.signal, AbortSignal.timeout(options.timeoutMs ?? 3_000)]), options.mediaOrigin)
				.then((value) => {
					if (!controller.signal.aborted) {
						const ttl = value.reason === 'check_failed' || value.reason === 'rate_limited' ? 10_000 : 300_000;
						while (cache.size >= maxCache) cache.delete(cache.keys().next().value!);
						cache.set(clip.url, { value, expiresAt: nowMs() + ttl });
					}
					return value;
				}).finally(() => { current.settled = true; if (active.get(clip.url) === current) active.delete(clip.url); });
		}
		job.consumers++;
		try { return { ...await waitForCheck(job.promise, signal) }; }
		finally {
			job.consumers--;
			if (!job.settled && job.consumers === 0) job.controller.abort();
		}
	}
	return { check };
}

export const videoAvailabilityService = createVideoAvailabilityService();

/* Media request and cancellation helpers */

export function isVideoAvailabilityRequest(value: unknown): value is VideoAvailabilityRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const clip = value as Record<string, unknown>;
	return Object.keys(clip).length === 3 && Object.keys(clip).every((key) => ['url', 'gameId', 'eventId'].includes(key)) &&
		typeof clip.url === 'string' && typeof clip.gameId === 'string' && typeof clip.eventId === 'string' && isCanonicalNbaVideo(clip);
}

async function probeClip(clip: VideoAvailabilityRequest, fetchImpl: typeof fetch, signal: AbortSignal, mediaOrigin?: string): Promise<VideoAvailability> {
	let url = videoPlaybackUrl(clip.url);
	try {
		for (let redirects = 0; redirects <= 2; redirects++) {
			// NBA's HEAD response can be a slate even when GET serves the exact footage.
			const response = await fetchImpl(url, { method: 'GET', headers: buildNbaMediaRequestHeaders({ origin: mediaOrigin, range: 'bytes=0-1023' }), redirect: 'manual', signal });
			// Cancel immediately, including when a server ignores the requested byte range.
			await response.body?.cancel();
			if (![301, 302, 303, 307, 308].includes(response.status)) return classifyNbaMediaResponse(response);
			const location = response.headers.get('location');
			if (!location || redirects === 2) return UNKNOWN;
			const target = verifiedNbaMediaRedirect(location, url, clip);
			if (!target) return UNKNOWN;
			url = target;
		}
	} catch { return UNKNOWN; }
	return UNKNOWN;
}

function completeMediaBytes(response: Response): string | null {
	if (response.status !== 206) return response.headers.get('content-length');
	const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
	if (!range) return null;
	const [start, end, total] = range.slice(1).map(Number);
	if (![start, end, total].every(Number.isSafeInteger) || start > end || end >= total) return null;
	return String(total);
}

function waitForCheck(promise: Promise<VideoAvailability>, signal?: AbortSignal): Promise<VideoAvailability> {
	if (!signal) return promise;
	return new Promise((resolve, reject) => {
		const abort = () => { cleanup(); reject(signal.reason ?? new DOMException('Request was cancelled.', 'AbortError')); };
		const cleanup = () => signal.removeEventListener('abort', abort);
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		promise.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
	});
}

/* End media request and cancellation helpers */
