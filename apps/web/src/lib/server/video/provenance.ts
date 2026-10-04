import { videoPlaybackUrl } from '$lib/contracts/video-media-url';

/** Exact event provenance restricts server-side video requests to official NBA assets. */
export function isCanonicalNbaVideo(clip: { url?: unknown; gameId?: unknown; eventId?: unknown }): boolean {
	if (typeof clip.url !== 'string' || clip.url.length > 1_024 || typeof clip.gameId !== 'string' || typeof clip.eventId !== 'string') return false;
	try {
		const url = new URL(clip.url);
		const parts = url.pathname.match(/^\/nba\/pbp\/media\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{10})\/(\d{1,9})\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.mp4$/);
		if (!parts || url.protocol !== 'https:' || url.hostname !== 'videos.nba.com' || url.username || url.password ||
			(url.port && url.port !== '443') || url.search || url.hash || parts[4] !== clip.gameId || parts[5] !== clip.eventId) return false;
		const date = `${parts[1]}-${parts[2]}-${parts[3]}`;
		const parsed = new Date(`${date}T00:00:00Z`);
		return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
	} catch { return false; }
}

/* Verified media redirect helpers */

/** Reuses the playback cache repair only after a redirect still proves the original event. */
export function verifiedNbaMediaRedirect(location: string, currentUrl: string, clip: { gameId: string; eventId: string }): string | null {
	try {
		const target = new URL(location, currentUrl);
		// Accept only our exact internal cache key; arbitrary or duplicate query parameters remain rejected.
		if (target.search === '?hoop_hub_media=referrer-v1') target.search = '';
		if (!isCanonicalNbaVideo({ ...clip, url: target.href })) return null;
		return videoPlaybackUrl(target.href);
	} catch { return null; }
}

/* End verified media redirect helpers */
