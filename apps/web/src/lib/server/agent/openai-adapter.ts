import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import OpenAI from 'openai';
import type {
	ChatCompletionFunctionTool,
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall
} from 'openai/resources/chat/completions';
import type {
	DynamicAgentAdapter,
	DynamicAgentChatMessage,
	DynamicAgentCompletionInput,
	DynamicAgentToolDefinition
} from './types';

/**
 * Keeps OpenAI's chat-completions wire format outside the agent service so tests can script model turns.
 */
export function createOpenAIDynamicAgentAdapter(): DynamicAgentAdapter {
	const apiKey = readAgentEnv('OPENAI_API_KEY');
	const model = readAgentEnv('OPENAI_AGENT_MODEL') ?? readAgentEnv('OPENAI_PLANNER_MODEL');

	if (!apiKey || apiKey.trim().length === 0) {
		throw new Error('OPENAI_API_KEY is required for dynamic agent runtime.');
	}

	if (!model || model.trim().length === 0) {
		throw new Error('OPENAI_AGENT_MODEL or OPENAI_PLANNER_MODEL is required for dynamic agent runtime.');
	}

	const client = new OpenAI({ apiKey });

	return {
		async complete(input: DynamicAgentCompletionInput) {
			const completion = await client.chat.completions.create({
				model,
				temperature: input.responseFormat ? 0.1 : 0,
				messages: input.messages.map(toOpenAIMessage),
				...(input.tools && input.tools.length > 0
					? {
							tools: input.tools.map(toOpenAITool),
							tool_choice: 'auto' as const
						}
					: {}),
				...(input.responseFormat
					? {
							response_format: {
								type: 'json_schema' as const,
								json_schema: input.responseFormat
							}
						}
					: {})
			});
			const message = completion.choices[0]?.message;
			if (!message) {
				throw new Error('Dynamic agent model returned no message.');
			}

			return {
				content: message.content ?? null,
				usage: completion.usage
					? {
							inputTokens: completion.usage.prompt_tokens,
							outputTokens: completion.usage.completion_tokens,
							totalTokens: completion.usage.total_tokens
						}
					: undefined,
				toolCalls:
					message.tool_calls
						?.filter(isFunctionToolCall)
						.map((toolCall) => ({
							id: toolCall.id,
							name: toolCall.function.name,
							arguments: toolCall.function.arguments
						})) ?? []
			};
		}
	};
}

/* Helper functions */

let agentEnvLoaded = false;

function readAgentEnv(name: 'OPENAI_API_KEY' | 'OPENAI_AGENT_MODEL' | 'OPENAI_PLANNER_MODEL'): string | undefined {
	const directValue = process.env[name]?.trim();
	if (directValue) {
		return directValue;
	}

	if (!agentEnvLoaded && typeof process.loadEnvFile === 'function') {
		for (const candidate of ['.env.local', '.env.development', '.env']) {
			const path = resolve(process.cwd(), candidate);
			if (!existsSync(path)) {
				continue;
			}

			try {
				process.loadEnvFile(path);
			} catch {
				// Optional env files are best effort; required-variable guards above report the actionable error.
			}
		}
		agentEnvLoaded = true;
	}

	const loadedValue = process.env[name]?.trim();
	return loadedValue && loadedValue.length > 0 ? loadedValue : undefined;
}

function toOpenAIMessage(message: DynamicAgentChatMessage): ChatCompletionMessageParam {
	if (message.role === 'tool') {
		return {
			role: 'tool',
			tool_call_id: message.toolCallId,
			content: message.content
		};
	}

	if (message.role === 'assistant') {
		return {
			role: 'assistant',
			content: message.content,
			...(message.toolCalls && message.toolCalls.length > 0
				? {
						tool_calls: message.toolCalls.map((toolCall) => ({
							id: toolCall.id,
							type: 'function' as const,
							function: {
								name: toolCall.name,
								arguments: toolCall.arguments
							}
						}))
					}
				: {})
		};
	}

	return {
		role: message.role,
		content: message.content
	};
}

function toOpenAITool(tool: DynamicAgentToolDefinition): ChatCompletionFunctionTool {
	return {
		type: 'function',
		function: tool.function as ChatCompletionFunctionTool['function']
	};
}

function isFunctionToolCall(
	toolCall: ChatCompletionMessageToolCall
): toolCall is Extract<ChatCompletionMessageToolCall, { type: 'function' }> {
	return toolCall.type === 'function';
}
