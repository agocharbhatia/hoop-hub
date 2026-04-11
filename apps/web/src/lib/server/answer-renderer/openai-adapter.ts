import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type {
	GroundedAnswerSynthesisAdapter,
	GroundedAnswerSynthesisInput
} from './service';

const ANSWER_RENDERER_CONTEXT_PREFIX = 'Grounded answer context: ';

function buildAnswerRendererOutputSchema() {
	return {
		name: 'grounded_answer_renderer',
		strict: true,
		schema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				answer: {
					type: 'string'
				}
			},
			required: ['answer']
		}
	} as const;
}

type RenderableToolResultContext = {
	resolvedQuery: GroundedAnswerSynthesisInput['toolResults'][number]['response']['provenance']['resolvedQuery'];
	result: GroundedAnswerSynthesisInput['toolResults'][number]['response']['result'];
	warnings: GroundedAnswerSynthesisInput['toolResults'][number]['response']['warnings'];
};

function buildAnswerContext(input: GroundedAnswerSynthesisInput) {
	return {
		question: input.question,
		warnings: input.warnings,
		toolResults: input.toolResults.map((toolResult) => ({
			resolvedQuery: toolResult.response.provenance.resolvedQuery,
			result: toolResult.response.result,
			warnings: toolResult.response.warnings
		})) satisfies RenderableToolResultContext[]
	};
}

export function _buildAnswerRendererMessagesForTests(
	input: GroundedAnswerSynthesisInput
): ChatCompletionMessageParam[] {
	return [
		{
			role: 'system',
			content:
				'You write the final user-facing answer for a grounded NBA stats query. Use only the provided grounded data and warnings. Never invent values, dates, teams, outcomes, or certainty that is not present in the context.'
		},
		{
			role: 'system',
			content:
				'Answer naturally, like a good analyst talking to a human, not like a schema dump. Prefer short, clear basketball language. Rewrite encoded values like "W 3" into natural phrasing like "a three-game winning streak."'
		},
		{
			role: 'system',
			content:
				'If the question includes multiple parts and only some are supported, answer the supported parts directly and mention the limitation briefly only if the warnings require it. If data is partial or stale, be honest and concise. Do not mention internal field names, tool names, or JSON structure.'
		},
		{
			role: 'system',
			content: `${ANSWER_RENDERER_CONTEXT_PREFIX}${JSON.stringify(buildAnswerContext(input))}`
		},
		{
			role: 'user',
			content: input.question
		}
	];
}

/**
 * Isolates the OpenAI call so grounded answer synthesis can evolve independently from route orchestration.
 */
export function createOpenAIAnswerRendererAdapter(): GroundedAnswerSynthesisAdapter {
	const apiKey = readAnswerRendererEnv('OPENAI_API_KEY');
	const model =
		readAnswerRendererEnv('OPENAI_ANSWER_RENDERER_MODEL') ??
		readAnswerRendererEnv('OPENAI_PLANNER_MODEL');

	if (!apiKey || apiKey.trim().length === 0) {
		throw new Error('OPENAI_API_KEY is required for answer renderer runtime.');
	}

	if (!model || model.trim().length === 0) {
		throw new Error('OPENAI_ANSWER_RENDERER_MODEL or OPENAI_PLANNER_MODEL is required for answer renderer runtime.');
	}

	const client = new OpenAI({ apiKey });

	return {
		async synthesizeAnswer(input: GroundedAnswerSynthesisInput): Promise<unknown> {
			const completion = await client.chat.completions.create({
				model,
				temperature: 0.2,
				messages: buildAnswerRendererMessages(input),
				response_format: {
					type: 'json_schema',
					json_schema: buildAnswerRendererOutputSchema()
				}
			});
			const content = completion.choices[0]?.message?.content;
			if (!content) {
				throw new Error('Answer renderer returned an empty response.');
			}

			try {
				return JSON.parse(content);
			} catch (error) {
				throw new Error(`Answer renderer returned invalid JSON: ${String(error)}`);
			}
		}
	};
}

let answerRendererEnvLoaded = false;

function readAnswerRendererEnv(
	name: 'OPENAI_API_KEY' | 'OPENAI_ANSWER_RENDERER_MODEL' | 'OPENAI_PLANNER_MODEL'
): string | undefined {
	const directValue = process.env[name]?.trim();
	if (directValue) {
		return directValue;
	}

	if (!answerRendererEnvLoaded && typeof process.loadEnvFile === 'function') {
		for (const candidate of ['.env.local', '.env.development', '.env']) {
			const path = resolve(process.cwd(), candidate);
			if (!existsSync(path)) {
				continue;
			}

			try {
				process.loadEnvFile(path);
			} catch {
				// Ignore malformed optional env files here and rely on the required-variable guard below.
			}
		}
		answerRendererEnvLoaded = true;
	}

	const loadedValue = process.env[name]?.trim();
	return loadedValue && loadedValue.length > 0 ? loadedValue : undefined;
}

function buildAnswerRendererMessages(input: GroundedAnswerSynthesisInput): ChatCompletionMessageParam[] {
	return _buildAnswerRendererMessagesForTests(input);
}

export function _getAnswerRendererOutputSchemaForTests() {
	return buildAnswerRendererOutputSchema();
}
