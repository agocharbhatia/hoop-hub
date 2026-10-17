import { resolvePlayerEntity, resolveTeamEntity } from '$lib/entities/entity-media';

const MAX_IMAGE_BYTES = 1_048_576, MAX_CACHE_BYTES = 8_388_608, MAX_CACHE_ENTRIES = 128, MAX_IN_FLIGHT = 4;
type ImageAsset = { bytes: Uint8Array<ArrayBuffer>; contentType: string; expiresAt: number };

/** A fixed identity lookup supplies export-safe image bytes without becoming an arbitrary URL proxy. */
export function createEntityMediaLoader(fetcher: typeof fetch = fetch, now = Date.now) {
	const cache = new Map<string, ImageAsset>(), inFlight = new Map<string, Promise<ImageAsset | null>>();
	let cacheBytes = 0;
	return async function load(kind: string, id: string): Promise<ImageAsset | null> {
		const entity = kind === 'player' ? resolvePlayerEntity({ id }) : kind === 'team' ? resolveTeamEntity({ id }) : null;
		if (!entity) return null;
		const key = `${kind}:${id}`, cached = cache.get(key);
		if (cached) {
			cache.delete(key);
			if (cached.expiresAt > now()) { cache.set(key, cached); return cached; }
			cacheBytes -= cached.bytes.byteLength;
		}
		const pending = inFlight.get(key); if (pending) return pending;
		if (inFlight.size >= MAX_IN_FLIGHT) return null;
		const request = (async () => {
			try {
				const response = await fetcher(entity.imageUrl, { signal: AbortSignal.timeout(4000), redirect: 'error', headers: { Accept: kind === 'player' ? 'image/png' : 'image/svg+xml' } });
				const contentType = response.headers.get('content-type')?.split(';')[0].trim();
				if (!response.ok || contentType !== (kind === 'player' ? 'image/png' : 'image/svg+xml') || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES || !response.body) { await response.body?.cancel(); return null; }
				const bytes = await imageBytes(response.body); if (!bytes) return null;
				const asset = { bytes, contentType, expiresAt: now() + 86_400_000 };
				while (cache.size && (cache.size >= MAX_CACHE_ENTRIES || cacheBytes + bytes.byteLength > MAX_CACHE_BYTES)) { const oldest = cache.keys().next().value!; cacheBytes -= cache.get(oldest)!.bytes.byteLength; cache.delete(oldest); }
				cache.set(key, asset); cacheBytes += bytes.byteLength;
				return asset;
			} catch { return null; }
		})();
		inFlight.set(key, request);
		try { return await request; } finally { inFlight.delete(key); }
	};
}

/* Bounded image stream helpers */

async function imageBytes(body: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer> | null> {
	const reader = body.getReader(), chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > MAX_IMAGE_BYTES) { await reader.cancel(); return null; } chunks.push(chunk.value); }
	} finally { reader.releaseLock(); }
	if (!size) return null;
	const bytes = new Uint8Array(size); let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return bytes;
}

/* End bounded image stream helpers */

export const loadEntityMedia = createEntityMediaLoader();
