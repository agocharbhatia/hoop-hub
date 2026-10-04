import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import { createPersistentQuerySessionStore } from '$lib/server/agent/query-session-store';
import { createClipExportService } from '$lib/server/clip-exports/service';
import { DataStore } from '$lib/server/data/store/data-store';
import { createResearchRepository } from '$lib/server/research/repository';
import { withPrincipal, type ResearchPrincipal } from './context';

/* Ownership fixture helpers */
const alice: ResearchPrincipal = { userId: 'alice', email: 'alice@example.com', name: 'Alice', mode: 'local' };
const bob: ResearchPrincipal = { ...alice, userId: 'bob', email: 'bob@example.com', name: 'Bob' };
const response: QueryAnswerResponse = { status: 'ok', answer: 'Private answer', warnings: [], citations: [], toolResults: [], traceId: 'private-trace', artifacts: [{
	type: 'video_playlist', title: 'Private playlist', clips: [{ gameId: '0022400449', eventId: '34', description: 'Made shot', thumbnailUrl: null, gameDate: '2024-12-31', url: 'https://videos.nba.com/nba/pbp/media/2024/12/31/0022400449/34/clip.mp4' }],
	source: { toolName: 'find_video_clips', endpointId: 'videodetailsasset', resultSetName: 'playlist', request: {} }
}] };
/* End ownership fixture helpers */

test('foreign sessions cannot be listed, read, renamed, deleted, followed up or overwritten', () => {
	const data = new DataStore({ dbPath: ':memory:' }); const repository = createResearchRepository({ store: data, maxSessions: 1 });
	const id = crypto.randomUUID(); const other = crypto.randomUUID();
	try {
		const saved = withPrincipal(alice, () => repository.saveResult(id, { question: 'Alice question', response }))!;
		withPrincipal(bob, () => {
			assert.equal(repository.list().sessions.length, 0); assert.equal(repository.get(id), null); assert.equal(repository.getTurn(id, saved.turnId), null);
			assert.equal(repository.rename(id, 'stolen'), false); repository.delete(id);
			assert.throws(() => createPersistentQuerySessionStore({ repository }).load(id), /expired/);
			assert.throws(() => repository.writeContext(id, '{}'), /ownership/);
			assert.throws(() => repository.saveResult(id, { question: 'overwrite', response }), /ownership/);
			repository.saveResult(other, { question: 'Bob question', response });
		});
		withPrincipal(alice, () => assert.equal(repository.get(id)?.session.title, 'Alice question'));
		assert.equal(repository.get(id), null); // Legacy local mode never becomes an invited account.
	} finally { data.close(); }
});

test('export ownership survives completion and blocks foreign status, downloads and cancellation', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'hoop-beta-export-')); const data = new DataStore({ dbPath: ':memory:' });
	const repository = createResearchRepository({ store: data }); const sessionId = crypto.randomUUID();
	const service = createClipExportService({ store: data, repository, outputDir: directory, compile: async (input) => { input.onClipCompleted(); await writeFile(input.outputPath, 'synthetic-test-video'); } });
	try {
		const turn = withPrincipal(alice, () => repository.saveResult(sessionId, { question: 'clips', response }))!;
		const request = { sessionId, turnId: turn.turnId, artifactIndex: 0 };
		const job = withPrincipal(alice, () => service.create(request));
		withPrincipal(bob, () => { assert.equal(service.get(job.id), null); assert.equal(service.getDownload(job.id), null); assert.equal(service.cancel(job.id), false); assert.throws(() => service.create(request), /not found/); });
		await withPrincipal(alice, async () => {
			for (let i = 0; i < 100 && service.get(job.id)?.status !== 'completed'; i++) await new Promise((resolve) => setTimeout(resolve, 5));
			assert.equal(service.get(job.id)?.status, 'completed'); assert.ok(service.getDownload(job.id));
		});
		withPrincipal(bob, () => assert.equal(service.getDownload(job.id), null));
	} finally { data.close(); rmSync(directory, { recursive: true, force: true }); }
});
