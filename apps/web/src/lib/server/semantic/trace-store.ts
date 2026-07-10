import type { QueryAnswerPlannedToolRequest } from '$lib/contracts/answer-response';
import type { Citation, DataFreshnessMode, TraceSourceCall } from '$lib/contracts/chat';
import type {
	DynamicAgentQueryTraceResponse,
	OrchestrationQueryTraceResponse,
	QueryTraceResponse,
	SemanticQueryTraceResponse
} from '$lib/contracts/query-trace';
import type { StatsQueryStatus, StatsQueryWarning } from '$lib/contracts/semantic-query';
import { getDataStore } from '$lib/server/data/store';

type StoredOrchestrationTrace = {
	traceId: string;
	normalizedQuestion: string;
	status: StatsQueryStatus;
	warnings: StatsQueryWarning[];
	computations: OrchestrationQueryTraceResponse['computations'];
	latencyMs: Pick<OrchestrationQueryTraceResponse['latencyMs'], 'planning' | 'render'>;
	plannedToolRequests: QueryAnswerPlannedToolRequest[];
	executedStructuredTraceIds: string[];
};

const semanticTraceStore = new Map<string, SemanticQueryTraceResponse>();
const orchestrationTraceStore = new Map<string, StoredOrchestrationTrace>();
const dynamicAgentTraceStore = new Map<string, DynamicAgentQueryTraceResponse>();

/* Helper functions */

function cloneSourceCalls(sourceCalls: TraceSourceCall[]): TraceSourceCall[] {
	return sourceCalls.map((sourceCall) => ({ ...sourceCall }));
}

function cloneCitations(citations: Citation[]): Citation[] {
	return citations.map((citation) => ({ ...citation }));
}

function cloneWarnings(warnings: StatsQueryWarning[]): StatsQueryWarning[] {
	return warnings.map((warning) => ({ ...warning }));
}

function clonePlannedToolRequests(
	plannedToolRequests: QueryAnswerPlannedToolRequest[]
): QueryAnswerPlannedToolRequest[] {
	return plannedToolRequests.map((plannedToolRequest) => ({
		toolName: plannedToolRequest.toolName,
		request: JSON.parse(JSON.stringify(plannedToolRequest.request))
	}));
}

function cloneDynamicAgentTrace(trace: DynamicAgentQueryTraceResponse): DynamicAgentQueryTraceResponse {
	return {
		...trace,
		sourceCalls: cloneSourceCalls(trace.sourceCalls),
		executedSources: cloneCitations(trace.executedSources),
		warnings: cloneWarnings(trace.warnings),
		computations: trace.computations.map((computation) => ({ ...computation, sourceFields: [...computation.sourceFields] })),
		toolCalls: trace.toolCalls.map((toolCall) => ({
			...toolCall,
			request: JSON.parse(JSON.stringify(toolCall.request))
		})),
		artifacts: JSON.parse(JSON.stringify(trace.artifacts))
	};
}

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

function saveOrchestrationTraceReferences(
	traceId: string,
	plannedToolRequests: QueryAnswerPlannedToolRequest[],
	executedStructuredTraceIds: string[]
): void {
	try {
		getDataStore().replaceOrchestrationTraceReferences(traceId, plannedToolRequests, executedStructuredTraceIds);
	} catch (error) {
		console.error('Orchestration trace reference persistence failed:', error);
	}
}

function loadOrchestrationTraceReferences(traceId: string): {
	plannedToolRequests: QueryAnswerPlannedToolRequest[];
	executedStructuredTraceIds: string[];
} | null {
	try {
		return getDataStore().getOrchestrationTraceReferences(traceId);
	} catch (error) {
		console.error('Orchestration trace reference load failed:', error);
		return null;
	}
}

function getStoredSemanticTraceById(traceId: string): SemanticQueryTraceResponse | null {
	const trace = semanticTraceStore.get(traceId);
	if (!trace) {
		return null;
	}

	const persistedSourceCalls = loadTraceSourceCalls(traceId);
	if (!persistedSourceCalls || persistedSourceCalls.sourceCalls.length === 0) {
		return {
			...trace,
			executedSources: cloneCitations(trace.executedSources),
			sourceCalls: cloneSourceCalls(trace.sourceCalls),
			warnings: cloneWarnings(trace.warnings)
		};
	}

	return {
		...trace,
		dataFreshnessMode: persistedSourceCalls.dataFreshnessMode,
		sourceCalls: cloneSourceCalls(persistedSourceCalls.sourceCalls),
		executedSources: cloneCitations(trace.executedSources),
		warnings: cloneWarnings(trace.warnings)
	};
}

function dedupeCitations(citations: Citation[]): Citation[] {
	const seen = new Set<string>();
	const deduped: Citation[] = [];

	for (const citation of citations) {
		const key = JSON.stringify(citation);
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		deduped.push({ ...citation });
	}

	return deduped;
}

function aggregateOrchestrationTrace(
	trace: StoredOrchestrationTrace,
	plannedToolRequests: QueryAnswerPlannedToolRequest[],
	executedStructuredTraceIds: string[]
): OrchestrationQueryTraceResponse {
	const executedTraces = executedStructuredTraceIds
		.map((traceId) => getStoredSemanticTraceById(traceId))
		.filter((candidate): candidate is SemanticQueryTraceResponse => candidate !== null);
	const dataFreshnessMode: DataFreshnessMode = executedTraces.some(
		(executedTrace) => executedTrace.dataFreshnessMode === 'provisional_live'
	)
		? 'provisional_live'
		: 'nightly';
	const sourceCalls = executedTraces.flatMap((executedTrace) => cloneSourceCalls(executedTrace.sourceCalls));
	const executedSources = dedupeCitations(executedTraces.flatMap((executedTrace) => executedTrace.executedSources));
	const retrievalLatencyMs = executedTraces.reduce((sum, executedTrace) => sum + executedTrace.latencyMs.retrieval, 0);
	const computeLatencyMs = executedTraces.reduce((sum, executedTrace) => sum + executedTrace.latencyMs.compute, 0);
	const cache = executedTraces.reduce(
		(summary, executedTrace) => ({
			hits: summary.hits + executedTrace.cache.hits,
			misses: summary.misses + executedTrace.cache.misses
		}),
		{ hits: 0, misses: 0 }
	);

	return {
		traceId: trace.traceId,
		normalizedQuestion: trace.normalizedQuestion,
		status: trace.status,
		plannedToolRequests: clonePlannedToolRequests(plannedToolRequests),
		executedStructuredTraceIds: [...executedStructuredTraceIds],
		dataFreshnessMode,
		sourceCalls,
		executedSources,
		warnings: cloneWarnings(trace.warnings),
		computations: trace.computations.map((computation) => ({ ...computation, sourceFields: [...computation.sourceFields] })),
		latencyMs: {
			planning: trace.latencyMs.planning,
			retrieval: retrievalLatencyMs,
			compute: computeLatencyMs,
			render: trace.latencyMs.render,
			total: trace.latencyMs.planning + retrievalLatencyMs + computeLatencyMs + trace.latencyMs.render
		},
		cache
	};
}

export function saveSemanticTrace(trace: SemanticQueryTraceResponse): void {
	semanticTraceStore.set(trace.traceId, {
		...trace,
		executedSources: cloneCitations(trace.executedSources),
		sourceCalls: cloneSourceCalls(trace.sourceCalls),
		warnings: cloneWarnings(trace.warnings)
	});
	saveTraceSourceCalls(trace.traceId, trace.dataFreshnessMode, trace.sourceCalls);
}

export function saveOrchestrationTrace(
	trace: Pick<OrchestrationQueryTraceResponse, 'traceId' | 'normalizedQuestion' | 'status' | 'plannedToolRequests' | 'executedStructuredTraceIds' | 'warnings' | 'computations'> & {
		latencyMs: Pick<OrchestrationQueryTraceResponse['latencyMs'], 'planning' | 'render'>;
	}
): void {
	orchestrationTraceStore.set(trace.traceId, {
		traceId: trace.traceId,
		normalizedQuestion: trace.normalizedQuestion,
		status: trace.status,
		warnings: cloneWarnings(trace.warnings),
		computations: trace.computations.map((computation) => ({ ...computation, sourceFields: [...computation.sourceFields] })),
		latencyMs: {
			planning: trace.latencyMs.planning,
			render: trace.latencyMs.render
		},
		plannedToolRequests: clonePlannedToolRequests(trace.plannedToolRequests),
		executedStructuredTraceIds: [...trace.executedStructuredTraceIds]
	});
	saveOrchestrationTraceReferences(trace.traceId, trace.plannedToolRequests, trace.executedStructuredTraceIds);
}

export function saveDynamicAgentTrace(trace: DynamicAgentQueryTraceResponse): void {
	dynamicAgentTraceStore.set(trace.traceId, cloneDynamicAgentTrace(trace));
	saveTraceSourceCalls(trace.traceId, trace.dataFreshnessMode, trace.sourceCalls);
}

export function getSemanticTraceById(traceId: string): SemanticQueryTraceResponse | null {
	return getStoredSemanticTraceById(traceId);
}

export function getQueryTraceById(traceId: string): QueryTraceResponse | null {
	const dynamicAgentTrace = dynamicAgentTraceStore.get(traceId);
	if (dynamicAgentTrace) {
		const persistedSourceCalls = loadTraceSourceCalls(traceId);
		return {
			...cloneDynamicAgentTrace(dynamicAgentTrace),
			...(persistedSourceCalls
				? {
						dataFreshnessMode: persistedSourceCalls.dataFreshnessMode,
						sourceCalls: cloneSourceCalls(persistedSourceCalls.sourceCalls)
					}
				: {})
		};
	}

	const orchestrationTrace = orchestrationTraceStore.get(traceId);
	if (orchestrationTrace) {
		const persistedReferences = loadOrchestrationTraceReferences(traceId);
		return aggregateOrchestrationTrace(
			orchestrationTrace,
			persistedReferences?.plannedToolRequests ?? orchestrationTrace.plannedToolRequests,
			persistedReferences?.executedStructuredTraceIds ?? orchestrationTrace.executedStructuredTraceIds
		);
	}

	return getStoredSemanticTraceById(traceId);
}
