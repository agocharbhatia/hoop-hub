import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { json } from '@sveltejs/kit';
import { getClipExportService } from '$lib/server/clip-exports/runtime';
import { RESEARCH_ID_PATTERN } from '$lib/server/research/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
	if (!RESEARCH_ID_PATTERN.test(params.id)) return json({ error: 'Invalid export ID.' }, { status: 400 });
	const download = getClipExportService().getDownload(params.id);
	if (!download) return json({ error: 'Compiled export was not found or has expired.' }, { status: 404 });
	const headers: Record<string, string> = { 'content-type': 'video/mp4', 'content-disposition': `attachment; filename="${download.filename}"`, 'accept-ranges': 'bytes', 'cache-control': 'private, no-store' };
	let start = 0; let end = download.size - 1; let status = 200;
	const range = request.headers.get('range');
	if (range) {
		const match = range.match(/^bytes=(\d+)-(\d*)$/);
		if (!match) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${download.size}` } });
		start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end;
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= download.size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${download.size}` } });
		headers['content-range'] = `bytes ${start}-${end}/${download.size}`; status = 206;
	}
	headers['content-length'] = String(end - start + 1);
	return new Response(Readable.toWeb(createReadStream(download.path, { start, end })) as ReadableStream<Uint8Array>, { status, headers });
};
