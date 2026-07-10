import type { DynamicAgentAdapter, DynamicAgentModelResponse } from '$lib/server/agent/types';
import type { EvalCase } from './types';

/**
 * Replays explicit model decisions so local evals remain byte-for-byte reproducible and free of model cost.
 */
export function createEvalScriptedModel(evalCase: EvalCase): DynamicAgentAdapter {
	const responses = buildResponses(evalCase);

	return {
		async complete() {
			const response = responses.shift();
			if (!response) {
				throw new Error(`Eval case '${evalCase.id}' exhausted its scripted model responses.`);
			}
			return response;
		}
	};
}

/* Helper functions */

function buildResponses(evalCase: EvalCase): DynamicAgentModelResponse[] {
	const turns = evalCase.local.turns.map((turn, turnIndex): DynamicAgentModelResponse => {
		if (turn.kind === 'stop') {
			return { content: null, toolCalls: [] };
		}

		return {
			content: null,
			toolCalls: turn.calls.map((call, callIndex) => ({
				id: `${evalCase.id}-${turnIndex + 1}-${callIndex + 1}`,
				name: call.name,
				arguments: JSON.stringify(call.arguments)
			}))
		};
	});

	return [
		...turns,
		{
			content: JSON.stringify(evalCase.local.finalOutput),
			toolCalls: []
		}
	];
}
