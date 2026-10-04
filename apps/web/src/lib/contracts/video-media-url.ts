/** Escapes cached NBA fallback videos after the referrer fix, without changing the saved event or asset. */
export function videoPlaybackUrl(source: string): string {
	try {
		const url = new URL(source);
		if (url.origin !== 'https://videos.nba.com' || url.username || url.password || url.search || url.hash ||
			!url.pathname.startsWith('/nba/pbp/media/') || !url.pathname.endsWith('.mp4')) return source;
		// NBA's referrer-dependent responses omit Vary. A stable key repairs old cache entries once, then permits reuse.
		url.searchParams.set('hoop_hub_media', 'referrer-v1');
		return url.href;
	} catch { return source; }
}
