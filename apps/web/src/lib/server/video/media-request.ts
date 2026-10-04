/** Keeps public NBA media requests consistent with playback without sending research paths or credentials. */
export function buildNbaMediaRequestHeaders(options: { origin?: string; range?: string } = {}): Headers {
	const headers = new Headers({
		Accept: '*/*',
		'Accept-Language': 'en-US,en;q=0.9',
		'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
		Referer: publicAppOrigin(options.origin ?? process.env.ORIGIN ?? process.env.HOOP_HUB_APP_ORIGIN),
		'Sec-Fetch-Dest': 'video'
	});
	if (options.range) headers.set('Range', options.range);
	return headers;
}

/* Public request context helpers */

function publicAppOrigin(configured: string | undefined): string {
	const url = new URL(configured ?? 'http://localhost/');
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
		throw new Error('NBA media requests require an HTTP(S) app origin without credentials.');
	}
	return `${url.origin}/`;
}

/* End public request context helpers */
