import type { QueryAnswerArtifact, QueryAnswerResponse } from '$lib/contracts/answer-response';
import type { QueryProgress } from '$lib/contracts/query-progress';

type StreamCallbacks = {
	onprogress: (progress: QueryProgress) => void;
	onartifacts: (artifacts: QueryAnswerArtifact[]) => void;
};

/** Read actual server updates across arbitrary network chunks without exposing transport diagnostics. */
export async function consumeQueryStream(response: Response, callbacks: StreamCallbacks): Promise<QueryAnswerResponse> {
	if (!response.headers.get('content-type')?.includes('text/event-stream')) return await response.json() as QueryAnswerResponse;
	if (!response.body) throw new Error('The research connection did not open. Please try again.');
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			const { value, done } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			let boundary: RegExpExecArray | null;
			while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
				const frame = buffer.slice(0, boundary.index);
				buffer = buffer.slice(boundary.index + boundary[0].length);
				const event = parseEvent(frame);
				if (!event) continue;
				if (event.name === 'error') throw new Error(isRecord(event.data) && typeof event.data.message === 'string' ? event.data.message : 'The research request could not finish.');
				if (event.name === 'progress' && isProgress(event.data)) callbacks.onprogress(event.data);
				if (event.name === 'artifacts' && isRecord(event.data) && Array.isArray(event.data.artifacts)) callbacks.onartifacts(event.data.artifacts as QueryAnswerArtifact[]);
				if (event.name === 'result' && isAnswer(event.data)) return event.data;
			}
			if (buffer.length > 16_000_000) throw new Error('The research update was too large to display. Please narrow the question.');
			if (done) throw new Error('The connection ended before the research finished. Please try again.');
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

/** Retain unchanged artifact objects so fresh stream snapshots do not reset chart or playback controls. */
export function reconcileArtifactSnapshot(previous: QueryAnswerArtifact[], incoming: QueryAnswerArtifact[]): QueryAnswerArtifact[] {
	return incoming.map((artifact, index) => previous[index] && JSON.stringify(previous[index]) === JSON.stringify(artifact) ? previous[index] : artifact);
}

// --- Stream decoding helpers ---

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProgress(value: unknown): value is QueryProgress {
	return isRecord(value) && ['planning', 'resolving', 'fetching', 'computing', 'writing'].includes(String(value.stage))
		&& typeof value.message === 'string' && typeof value.completedTools === 'number' && Number.isFinite(value.completedTools)
		&& typeof value.elapsedMs === 'number' && Number.isFinite(value.elapsedMs);
}

function isAnswer(value: unknown): value is QueryAnswerResponse {
	return isRecord(value) && typeof value.answer === 'string' && typeof value.traceId === 'string'
		&& Array.isArray(value.artifacts) && Array.isArray(value.warnings) && Array.isArray(value.citations);
}

function parseEvent(frame: string): { name: string; data: unknown } | null {
	let name = 'message';
	const data: string[] = [];
	for (const line of frame.split(/\r?\n/)) {
		if (line.startsWith('event:')) name = line.slice(6).trim();
		if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
	}
	if (!data.length || !['progress', 'artifacts', 'result', 'error'].includes(name)) return null;
	try { return { name, data: JSON.parse(data.join('\n')) }; }
	catch { throw new Error('The research update could not be read. Please try again.'); }
}

// --- End stream decoding helpers ---
