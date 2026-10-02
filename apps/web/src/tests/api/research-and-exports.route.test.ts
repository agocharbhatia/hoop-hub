import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import { DataStore } from '$lib/server/data/store/data-store';
import { createResearchRepository } from '$lib/server/research/repository';
import { createClipExportService } from '$lib/server/clip-exports/service';
import { _setClipExportServiceForTests } from '$lib/server/clip-exports/runtime';
import { GET as listResearch, _setResearchRepositoryForTests } from '../../routes/api/research/+server';
import { GET as getResearch, PATCH as renameResearch, DELETE as deleteResearch, _setResearchDetailRepositoryForTests } from '../../routes/api/research/[sessionId]/+server';
import { POST as createExport } from '../../routes/api/clip-exports/+server';
import { GET as getExport } from '../../routes/api/clip-exports/[id]/+server';
import { GET as downloadExport } from '../../routes/api/clip-exports/[id]/download/+server';

/* Route fixture helpers */

function savedResponse(): QueryAnswerResponse {
	return { status: 'ok', answer: 'Verified clips.', artifacts: [{ type: 'video_playlist', title: 'NBA clips',
		clips: [{ gameId: '0022400449', eventId: '34', gameDate: '2024-12-31', thumbnailUrl: null, description: 'Barnes make', url: 'https://videos.nba.com/nba/pbp/media/2024/12/31/0022400449/34/clip.mp4' }],
		source: { toolName: 'find_video_clips', endpointId: 'videodetailsasset', resultSetName: 'playlist', request: {} } }], toolResults: [], citations: [], warnings: [], traceId: 'route-trace' };
}

/* End route fixture helpers */

test('research API lists, reopens, renames, validates, and deletes durable rendered history', async () => {
	const store = new DataStore({ dbPath: ':memory:' }); const repository = createResearchRepository({ store });
	_setResearchRepositoryForTests(repository); _setResearchDetailRepositoryForTests(repository);
	try {
		const sessionId = crypto.randomUUID(); repository.saveResult(sessionId, { question: 'Barnes highlights', response: savedResponse() });
		const list = await listResearch({ url: new URL('http://localhost/api/research?limit=1') } as never);
		assert.equal(list.status, 200); assert.equal((await list.json()).sessions[0].sessionId, sessionId);
		assert.equal((await listResearch({ url: new URL('http://localhost/api/research?limit=999') } as never)).status, 400);
		assert.equal((await listResearch({ url: new URL('http://localhost/api/research?cursor=invalid') } as never)).status, 400);
		const detail = await getResearch({ params: { sessionId } } as never);
		const body = await detail.json(); assert.equal(body.turns[0].response.artifacts[0].clips[0].eventId, '34'); assert.equal('toolResults' in body.turns[0].response, false);
		const renamed = await renameResearch({ params: { sessionId }, request: new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ title: 'Saved Barnes clips' }) }) } as never);
		assert.equal((await renamed.json()).session.title, 'Saved Barnes clips');
		assert.equal((await renameResearch({ params: { sessionId }, request: new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ title: 'x'.repeat(101) }) }) } as never)).status, 400);
		assert.equal((await getResearch({ params: { sessionId: '../invalid' } } as never)).status, 400);
		assert.equal((await deleteResearch({ params: { sessionId } } as never)).status, 204);
		assert.equal((await getResearch({ params: { sessionId } } as never)).status, 404);
	} finally { _setResearchRepositoryForTests(null); _setResearchDetailRepositoryForTests(null); store.close(); }
});

test('export API resolves stored clips and exposes bounded downloadable MP4 ranges', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'hoop-export-route-')); const store = new DataStore({ dbPath: ':memory:' });
	const repository = createResearchRepository({ store });
	const service = createClipExportService({ repository, store, outputDir: directory, compile: async (input) => { input.onClipCompleted(); await writeFile(input.outputPath, 'verified-mp4-bytes'); } });
	_setClipExportServiceForTests(service);
	try {
		const sessionId = crypto.randomUUID(); const turn = repository.saveResult(sessionId, { question: 'Show clips', response: savedResponse() })!;
		const request = { sessionId, turnId: turn.turnId, artifactIndex: 0 };
		const response = await createExport({ request: new Request('http://localhost/api/clip-exports', { method: 'POST', body: JSON.stringify(request) }) } as never);
		assert.equal(response.status, 202); const { job } = await response.json();
		for (let attempt = 0; service.get(job.id)?.status !== 'completed' && attempt < 100; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
		const status = await getExport({ params: { id: job.id } } as never); assert.equal((await status.json()).job.status, 'completed');
		const download = await downloadExport({ params: { id: job.id }, request: new Request('http://localhost') } as never);
		assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition') ?? '', /attachment/); assert.equal(await download.text(), 'verified-mp4-bytes');
		const range = await downloadExport({ params: { id: job.id }, request: new Request('http://localhost', { headers: { range: 'bytes=0-7' } }) } as never);
		assert.equal(range.status, 206); assert.equal(await range.text(), 'verified'); assert.equal(range.headers.get('content-range'), 'bytes 0-7/18');
		assert.equal((await downloadExport({ params: { id: job.id }, request: new Request('http://localhost', { headers: { range: 'bytes=999-1000' } }) } as never)).status, 416);
		assert.equal((await createExport({ request: new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ...request, url: 'https://example.com' }) }) } as never)).status, 400);
		assert.equal((await createExport({ request: new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ...request, sessionId: crypto.randomUUID() }) }) } as never)).status, 404);
	} finally { _setClipExportServiceForTests(null); store.close(); rmSync(directory, { recursive: true, force: true }); }
});
