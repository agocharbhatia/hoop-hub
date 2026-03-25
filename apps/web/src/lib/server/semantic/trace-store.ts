import type { DataFreshnessMode, TraceSourceCall } from '$lib/contracts/chat';
import type { QueryTraceResponse } from '$lib/contracts/query-trace';
import { getDataStore } from '$lib/server/data/store';

const semanticTraceStore = new Map<string, QueryTraceResponse>();

function saveTraceSourceCalls(traceId: string, dataFreshnessMode: DataFreshnessMode, sourceCalls: TraceSourceCall[]): void {
	try {
		getDataStore().replaceTraceSourceCalls(traceId, dataFreshnessMode, sourceCalls);
	} catch (error) {
		console.error('Semantic trace source-call persistence failed:', error);
	}
}

function loadTraceSourceCalls(traceId: string): {
	dataFreshnessMode: DataFreshnessMode;
	sourceCalls: TraceSourceCall[];
} | null {
	try {
		return getDataStore().getTraceSourceCalls(traceId);
	} catch (error) {
		console.error('Semantic trace source-call load failed:', error);
		return null;
	}
}

export function saveSemanticTrace(trace: QueryTraceResponse): void {
	semanticTraceStore.set(trace.traceId, trace);
	saveTraceSourceCalls(trace.traceId, trace.dataFreshnessMode, trace.sourceCalls);
}

export function getSemanticTraceById(traceId: string): QueryTraceResponse | null {
	const trace = semanticTraceStore.get(traceId);
	if (!trace) {
		return null;
	}

	const persistedSourceCalls = loadTraceSourceCalls(traceId);
	if (!persistedSourceCalls || persistedSourceCalls.sourceCalls.length === 0) {
		return trace;
	}

	return {
		...trace,
		dataFreshnessMode: persistedSourceCalls.dataFreshnessMode,
		sourceCalls: persistedSourceCalls.sourceCalls
	};
}
