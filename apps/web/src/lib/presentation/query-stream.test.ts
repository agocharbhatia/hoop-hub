import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryAnswerArtifact, QueryAnswerResponse } from '$lib/contracts/answer-response';
import { consumeQueryStream, reconcileArtifactSnapshot } from './query-stream';

// --- Stream fixture helpers ---

const result: QueryAnswerResponse = { status: 'ok', answer: 'Jokić’s result.', artifacts: [], toolResults: [], warnings: [], citations: [], traceId: 'stream-test' };
function streamed(source: string, chunkSize = 7): Response {
	const bytes = new TextEncoder().encode(source);
	return new Response(new ReadableStream<Uint8Array>({ start(controller) {
		for (let index = 0; index < bytes.length; index += chunkSize) controller.enqueue(bytes.slice(index, index + chunkSize));
		controller.close();
	} }), { headers: { 'content-type': 'text/event-stream' } });
}

// --- End stream fixture helpers ---

test('query streaming handles UTF-8, CRLF and frame boundaries while delivering verified snapshots before final result', async () => {
	const artifact: QueryAnswerArtifact = { type: 'table', shape: 'table', columns: ['player'], rows: [{ player: 'Jokić' }] };
	const source = ': heartbeat\r\n\r\nevent: ignored\r\ndata: invalid-json\r\n\r\n'
		+ 'event: progress\r\ndata: {"stage":"fetching",\r\ndata: "message":"Reading data…","completedTools":1,"elapsedMs":1200}\r\n\r\n'
		+ `event: artifacts\ndata: ${JSON.stringify({ artifacts: [artifact] })}\n\n`
		+ `event: result\ndata: ${JSON.stringify({ ...result, artifacts: [artifact] })}\n\n`;
	for (const chunkSize of [1, 7, 64]) {
		const updates: string[] = [];
		const answer = await consumeQueryStream(streamed(source, chunkSize), {
			onprogress: (progress) => { updates.push(progress.stage); assert.equal(progress.completedTools, 1); },
			onartifacts: (artifacts) => { updates.push('artifacts'); assert.deepEqual(artifacts, [artifact]); }
		});
		assert.deepEqual(updates, ['fetching', 'artifacts']);
		assert.deepEqual(answer, { ...result, artifacts: [artifact] });
	}
});

test('query streaming supports JSON compatibility and fails honestly on interrupted or corrupt streams', async () => {
	const callbacks = { onprogress() {}, onartifacts() {} };
	assert.deepEqual(await consumeQueryStream(Response.json(result), callbacks), result);
	await assert.rejects(consumeQueryStream(streamed('event: progress\ndata: {"stage":"planning","message":"Planning","completedTools":0,"elapsedMs":0}\n\n'), callbacks), /ended before the research finished/);
	await assert.rejects(consumeQueryStream(streamed('event: result\ndata: invalid-json\n\n'), callbacks), /update could not be read/);
	await assert.rejects(consumeQueryStream(streamed('event: error\ndata: {"message":"This session has expired."}\n\n'), callbacks), /session has expired/);
});

test('full artifact snapshots preserve unchanged control identity and replace changed evidence without mutating old artifacts', () => {
	const chart: QueryAnswerArtifact = { type: 'bar_chart', title: 'Points', xLabel: 'Player', yLabel: 'PPG', bars: [{ label: 'Player', value: 20 }] };
	const table: QueryAnswerArtifact = { type: 'table', shape: 'ranking', columns: ['value'], rows: [{ value: 20 }] };
	const added = reconcileArtifactSnapshot([chart], [structuredClone(chart), table]);
	assert.equal(added[0], chart);
	assert.equal(added[1], table);
	const changed = structuredClone(chart);
	if (changed.type === 'bar_chart') changed.bars[0].value = 21;
	assert.equal(reconcileArtifactSnapshot([chart], [changed])[0], changed);
	assert.equal(chart.bars[0].value, 20);
	assert.deepEqual(reconcileArtifactSnapshot([chart], []), []);
});

test('a terminal stream error retains the evidence already delivered without returning a completed answer', async () => {
	const artifact: QueryAnswerArtifact = { type: 'table', shape: 'table', columns: ['PTS'], rows: [{ PTS: 30 }] };
	let received: QueryAnswerArtifact[] = [];
	await assert.rejects(consumeQueryStream(streamed(`event: artifacts\ndata: ${JSON.stringify({ artifacts: [artifact] })}\n\nevent: error\ndata: {"message":"The request reached its time limit."}\n\n`), {
		onprogress() {}, onartifacts: (artifacts) => { received = artifacts; }
	}), /time limit/);
	assert.deepEqual(received, [artifact]);
});
