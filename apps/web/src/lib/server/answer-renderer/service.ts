import type {
	QueryAnswerArtifact,
	QueryAnswerToolResult
} from '$lib/contracts/answer-response';

export type AnswerRendererInput = {
	question: string;
	toolResults: QueryAnswerToolResult[];
};

export type AnswerRendererOutput = {
	answer: string;
	artifacts: QueryAnswerArtifact[];
};

export type AnswerRendererAdapter = {
	renderAnswer(input: AnswerRendererInput): Promise<unknown>;
};

export type AnswerRendererService = {
	renderAnswer(input: AnswerRendererInput): Promise<AnswerRendererOutput>;
};

/**
 * Validates answer-renderer outputs so the answer route keeps a small typed response contract.
 */
export function createAnswerRendererService(adapter: AnswerRendererAdapter): AnswerRendererService {
	return {
		async renderAnswer(input: AnswerRendererInput): Promise<AnswerRendererOutput> {
			const output = await adapter.renderAnswer(input);
			const validated = validateAnswerRendererOutput(output);
			if (!validated.ok) {
				throw new Error(validated.error);
			}

			return validated.value;
		}
	};
}

/**
 * Provides a stable grounded renderer for the one-tool slice without coupling the route to response-shaping rules.
 */
export function createDefaultAnswerRendererService(): AnswerRendererService {
	return createAnswerRendererService({
		async renderAnswer({ toolResults }) {
			const primaryResult = toolResults[0]?.response;
			const result = primaryResult?.result;

			if (!primaryResult || !result) {
				return {
					answer: primaryResult?.warnings[0]?.message ?? 'Unable to answer this query.',
					artifacts: []
				};
			}

			return {
				answer: buildAnswerText(result.summary, result.rows.length),
				artifacts: [
					{
						type: 'table',
						shape: result.shape,
						columns: result.columns,
						rows: result.rows
					}
				]
			};
		}
	});
}

/* Helper functions */

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isTableArtifact(value: unknown): value is Extract<QueryAnswerArtifact, { type: 'table' }> {
	if (!isPlainObject(value)) {
		return false;
	}

	return (
		value.type === 'table' &&
		(value.shape === 'table' ||
			value.shape === 'ranking' ||
			value.shape === 'timeseries' ||
			value.shape === 'comparison') &&
		isStringArray(value.columns) &&
		Array.isArray(value.rows)
	);
}

function isTextArtifact(value: unknown): value is Extract<QueryAnswerArtifact, { type: 'text' }> {
	return isPlainObject(value) && value.type === 'text' && typeof value.text === 'string';
}

function validateAnswerRendererOutput(
	input: unknown
): { ok: true; value: AnswerRendererOutput } | { ok: false; error: string } {
	if (!isPlainObject(input)) {
		return { ok: false, error: 'Answer renderer output must be an object.' };
	}

	if (typeof input.answer !== 'string' || input.answer.trim().length === 0) {
		return { ok: false, error: 'Answer renderer output must include a non-empty answer.' };
	}

	if (!Array.isArray(input.artifacts) || !input.artifacts.every((artifact) => isTableArtifact(artifact) || isTextArtifact(artifact))) {
		return { ok: false, error: 'Answer renderer output artifacts failed validation.' };
	}

	return {
		ok: true,
		value: {
			answer: input.answer.trim(),
			artifacts: input.artifacts
		}
	};
}

function buildAnswerText(summary: string | undefined, rowCount: number): string {
	const trimmedSummary = summary?.trim();
	if (trimmedSummary) {
		return trimmedSummary;
	}

	return rowCount > 0 ? `Returned ${rowCount} result${rowCount === 1 ? '' : 's'}.` : 'No rows returned for this query.';
}
