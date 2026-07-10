import type { DynamicAgentQueryTraceResponse } from '$lib/contracts/query-trace';
import { createOpenAIDynamicAgentAdapter } from '$lib/server/agent/openai-adapter';
import {
	createDefaultPlayerDirectoryAdapter,
	createDefaultTeamDirectoryAdapter,
	createDynamicQueryAgent
} from '$lib/server/agent/service';
import {
	createStatsEndpointFetcher,
	normalizeEndpointParams,
	type StatsEndpointFetcher
} from '$lib/server/data/adapters/stats-endpoint-client';
import { getQueryTraceById } from '$lib/server/semantic/trace-store';
import { evaluateEvalExecution } from './assertions';
import { createEvalFixtureFetcher } from './fixtures';
import { createEvalScriptedModel } from './scripted-model';
import type {
	EvalArtifactSummary,
	EvalCase,
	EvalEndpointCall,
	EvalExecution,
	EvalMode,
	EvalRunRecord,
	EvalSuiteResult
} from './types';

export type RunEvalSuiteOptions = {
	mode: EvalMode;
	cases: EvalCase[];
	repetitions?: number;
	now?: () => Date;
};

/**
 * Runs cases serially so live-model rate limits and shared NBA cache state stay diagnosable.
 */
export async function runEvalSuite(options: RunEvalSuiteOptions): Promise<EvalSuiteResult> {
	const now = options.now ?? (() => new Date());
	const startedAt = now().toISOString();
	const records: EvalRunRecord[] = [];

	for (const evalCase of options.cases) {
		const repetitions =
			options.repetitions ??
			(options.mode === 'local'
				? Math.max(evalCase.repetitions.local, evalCase.prompts.length)
				: evalCase.repetitions.live);
		for (let repetition = 1; repetition <= repetitions; repetition += 1) {
			const prompt = evalCase.prompts[(repetition - 1) % evalCase.prompts.length] ?? evalCase.prompts[0];
			records.push(await runEvalRepetition(evalCase, options.mode, prompt, repetition));
		}
	}

	const failedRuns = records.filter((record) => !record.passed).length;
	return {
		mode: options.mode,
		startedAt,
		finishedAt: now().toISOString(),
		records,
		passed: failedRuns === 0,
		passedRuns: records.length - failedRuns,
		failedRuns
	};
}

/* Helper functions */

async function runEvalRepetition(
	evalCase: EvalCase,
	mode: EvalMode,
	prompt: string,
	repetition: number
): Promise<EvalRunRecord> {
	const endpointCalls: EvalEndpointCall[] = [];
	const baseFetcher = mode === 'local' ? createEvalFixtureFetcher(evalCase.local.fixtureId) : createStatsEndpointFetcher();
	const endpointFetcher = captureEndpointCalls(baseFetcher, endpointCalls);
	const model = mode === 'local' ? createEvalScriptedModel(evalCase) : createOpenAIDynamicAgentAdapter();
	const agent = createDynamicQueryAgent({
		model,
		endpointFetcher,
		playerDirectory: createDefaultPlayerDirectoryAdapter(),
		teamDirectory: createDefaultTeamDirectoryAdapter(),
		...(mode === 'local' && evalCase.local.semanticResponses
			? { semanticExecutor: createScriptedSemanticExecutor(evalCase.local.semanticResponses) }
			: {})
	});
	const startedAt = performance.now();

	try {
		const response = await agent.answerQuestion(prompt);
		const trace = getDynamicTrace(response.traceId);
		const execution: EvalExecution = { response, trace, endpointCalls };
		const failures = evaluateEvalExecution(evalCase, execution);
		return {
			schemaVersion: 1,
			mode,
			caseId: evalCase.id,
			tags: [...evalCase.tags],
			prompt,
			repetition,
			passed: failures.length === 0,
			failures,
			traceId: response.traceId,
			status: response.status,
			toolCalls: trace.toolCalls.map((call) => ({ ...call, request: structuredClone(call.request) })),
			endpointCalls: structuredClone(endpointCalls),
			answer: response.answer,
			warnings: response.warnings.map((warning) => ({ ...warning })),
			artifacts: response.artifacts.map(summarizeArtifact),
			totalLatencyMs: trace.latencyMs.total,
			modelUsage: summarizeModelUsage(trace.modelUsage)
		};
	} catch (error) {
		return {
			schemaVersion: 1,
			mode,
			caseId: evalCase.id,
			tags: [...evalCase.tags],
			prompt,
			repetition,
			passed: false,
			failures: [`runner_error: ${error instanceof Error ? error.message : String(error)}`],
			traceId: null,
			status: 'runner_error',
			toolCalls: [],
			endpointCalls: structuredClone(endpointCalls),
			answer: '',
			warnings: [],
			artifacts: [],
			totalLatencyMs: Math.round(performance.now() - startedAt),
			modelUsage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: null }
		};
	}
}

function captureEndpointCalls(baseFetcher: StatsEndpointFetcher, calls: EvalEndpointCall[]): StatsEndpointFetcher {
	return async (request) => {
		let params = request.params;
		try {
			params = normalizeEndpointParams(request.endpointId, request.params);
		} catch {
			// The real fetcher will return the canonical validation error; retain raw arguments for diagnosis.
		}
		calls.push({ endpointId: request.endpointId, params: structuredClone(params) });
		return baseFetcher(request);
	};
}

function getDynamicTrace(traceId: string): DynamicAgentQueryTraceResponse {
	const trace = getQueryTraceById(traceId);
	if (!trace || !('runtime' in trace) || trace.runtime !== 'dynamic_agent') {
		throw new Error(`Dynamic trace '${traceId}' was not available after the eval run.`);
	}
	return trace;
}

function summarizeArtifact(artifact: EvalExecution['response']['artifacts'][number]): EvalArtifactSummary {
	if (artifact.type === 'table') {
		return { type: 'table', rows: artifact.rows.length, columns: [...artifact.columns] };
	}
	if (artifact.type === 'text_block') {
		return { type: 'text_block', characters: artifact.text.length };
	}
	if (artifact.type === 'line_chart') {
		const points = artifact.series.flatMap((series) => series.points);
		return {
			type: 'line_chart',
			series: artifact.series.length,
			points: points.length,
			firstX: points[0]?.x ?? null,
			lastX: points.at(-1)?.x ?? null
		};
	}
	if (artifact.type === 'bar_chart') {
		return { type: 'bar_chart', bars: artifact.bars.length };
	}
	if (artifact.type === 'shot_chart') {
		return {
			type: 'shot_chart',
			attempts: artifact.shots.length,
			makes: artifact.shots.filter((shot) => shot.made).length
		};
	}
	return {
		type: 'video_playlist',
		clips: artifact.clips.length,
		descriptions: artifact.clips.map((clip) => clip.description)
	};
}

function summarizeModelUsage(usage: DynamicAgentQueryTraceResponse['modelUsage']): EvalRunRecord['modelUsage'] {
	const inputRate = parseOptionalRate(process.env.HOOP_HUB_EVAL_INPUT_COST_PER_MILLION);
	const outputRate = parseOptionalRate(process.env.HOOP_HUB_EVAL_OUTPUT_COST_PER_MILLION);
	const estimatedCostUsd =
		inputRate === null || outputRate === null
			? null
			: Number(((usage.inputTokens * inputRate + usage.outputTokens * outputRate) / 1_000_000).toFixed(6));

	return { ...usage, estimatedCostUsd };
}

function parseOptionalRate(value: string | undefined): number | null {
	if (value === undefined || value.trim() === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function createScriptedSemanticExecutor(
	responses: NonNullable<EvalCase['local']['semanticResponses']>
): NonNullable<Parameters<typeof createDynamicQueryAgent>[0]['semanticExecutor']> {
	const remaining = responses.map((response) => structuredClone(response));
	return async () => {
		const response = remaining.shift();
		if (!response) throw new Error('Eval case exhausted its scripted semantic responses.');
		return response;
	};
}
