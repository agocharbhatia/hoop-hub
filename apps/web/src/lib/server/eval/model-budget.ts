import type { DynamicAgentAdapter, DynamicAgentModelResponse } from '$lib/server/agent/types';

export type EvalModelBudget = {
	remainingUsd: number;
	inputRate: number;
	outputRate: number;
	minCallIntervalMs?: number;
	lastRequestAt?: number;
};

type ObservedModelUsage = {
	calls: number;
	inputTokens: number;
	cachedInputTokens?: number;
	cacheWriteInputTokens?: number;
	outputTokens: number;
	totalTokens: number;
};

/** Reserves a worst-case token allowance before each call, keeping failed evals inside the shared spend ceiling. */
export function createBudgetedEvalModel(
	model: DynamicAgentAdapter,
	budget: EvalModelBudget,
	usage: ObservedModelUsage
): DynamicAgentAdapter {
	return {
		async complete(input) {
			// UTF-8 bytes bound text tokens conservatively, including serialized tool/schema definitions.
			const inputBound = new TextEncoder().encode(JSON.stringify(input)).length + 2048;
			const reservation = (inputBound * budget.inputRate * 1.25 + 8192 * budget.outputRate) / 1_000_000;
			if (reservation > budget.remainingUsd) throw new Error('Evaluation API budget exhausted before the next model call.');
			budget.remainingUsd -= reservation;
			const delay = Math.max(0, (budget.lastRequestAt ?? 0) + (budget.minCallIntervalMs ?? 0) - Date.now());
			if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
			budget.lastRequestAt = Date.now();
			let response: DynamicAgentModelResponse;
			for (let attempt = 0; ; attempt++) {
				try {
					response = await model.complete(input);
					break;
				} catch (error) {
					const apiError = error as { status?: number; code?: string; headers?: Headers };
					if (apiError.status !== 429 || apiError.code !== 'rate_limit_exceeded' || attempt >= 2) throw error;
					const retryAfter = Number(apiError.headers?.get('retry-after'));
					const retryMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(30_000, retryAfter * 1000) : 5_000 * (attempt + 1);
					await new Promise((resolve) => setTimeout(resolve, retryMs));
				}
			}
			usage.calls += 1;
			if (response.usage) {
				usage.inputTokens += response.usage.inputTokens;
				usage.cachedInputTokens = (usage.cachedInputTokens ?? 0) + (response.usage.cachedInputTokens ?? 0);
				usage.cacheWriteInputTokens = (usage.cacheWriteInputTokens ?? 0) + (response.usage.cacheWriteInputTokens ?? 0);
				usage.outputTokens += response.usage.outputTokens;
				usage.totalTokens += response.usage.totalTokens;
				const upperCost = (response.usage.inputTokens * budget.inputRate * 1.25 + response.usage.outputTokens * budget.outputRate) / 1_000_000;
				budget.remainingUsd += Math.max(0, reservation - upperCost);
			}
			return response;
		}
	};
}
