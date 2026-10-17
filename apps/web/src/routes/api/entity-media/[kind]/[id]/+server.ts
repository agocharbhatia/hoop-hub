import { loadEntityMedia } from '$lib/server/research/entity-media';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const asset = await loadEntityMedia(params.kind, params.id);
	if (!asset) return new Response(null, { status: 404, headers: { 'cache-control': 'private, max-age=30' } });
	return new Response(asset.bytes, { headers: { 'content-type': asset.contentType, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
};
