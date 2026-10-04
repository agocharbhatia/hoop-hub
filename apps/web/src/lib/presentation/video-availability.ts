import type { VideoAvailability } from '$lib/contracts/video-availability';

type ClipIdentity = { url: string; gameId?: string | null; eventId?: string | null };

/** Check only the chosen clip, without downloading an entire playlist before playback. */
export async function checkVideoAvailability(clip: ClipIdentity, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<VideoAvailability> {
	if (!clip.gameId || !clip.eventId) return { status: 'unknown', reason: 'unrecognized' };
	try {
		const response = await fetcher('/api/video-availability', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
			body: JSON.stringify({ url: clip.url, gameId: clip.gameId, eventId: clip.eventId })
		});
		if (!response.ok) return { status: 'unknown', reason: 'check_failed' };
		const result: unknown = await response.json();
		return isAvailability(result) ? result : { status: 'unknown', reason: 'check_failed' };
	} catch (error) {
		if (signal.aborted) throw error;
		return { status: 'unknown', reason: 'check_failed' };
	}
}

/* Helper functions */

function isAvailability(value: unknown): value is VideoAvailability {
	if (!value || typeof value !== 'object') return false;
	const result = value as Partial<VideoAvailability>;
	return ['unknown', 'unavailable'].includes(String(result.status)) &&
		['nba_unavailable', 'source_unavailable', 'rate_limited', 'check_failed', 'unrecognized'].includes(String(result.reason));
}

/* End helper functions */
