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
