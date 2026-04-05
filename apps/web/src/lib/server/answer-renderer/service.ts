import type {
	QueryAnswerArtifact,
	QueryAnswerToolResult
} from '$lib/contracts/answer-response';
import { getMetricById } from '$lib/server/metrics/registry';

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
 * Provides a stable grounded renderer so the answer route can return answer text plus minimal artifacts
 * even when one question fans out into multiple structured tool results.
 */
export function createDefaultAnswerRendererService(): AnswerRendererService {
	return createAnswerRendererService({
		async renderAnswer({ toolResults }) {
			const successfulResults = toolResults
				.map((toolResult) => toolResult.response.result)
				.filter((result): result is NonNullable<QueryAnswerToolResult['response']['result']> => result !== null);
			const primaryResponse = toolResults[0]?.response;

			if (successfulResults.length === 0) {
				return {
					answer: primaryResponse?.warnings[0]?.message ?? 'Unable to answer this query.',
					artifacts: []
				};
			}

			return {
				answer: buildCombinedAnswerText(toolResults),
				artifacts: successfulResults.map((result) => ({
					type: 'table',
					shape: result.shape,
					columns: result.columns,
					rows: result.rows
				}))
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

function isTextBlockArtifact(value: unknown): value is Extract<QueryAnswerArtifact, { type: 'text_block' }> {
	return isPlainObject(value) && value.type === 'text_block' && typeof value.text === 'string';
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

	if (
		!Array.isArray(input.artifacts) ||
		!input.artifacts.every(
			(artifact) => isTableArtifact(artifact) || isTextBlockArtifact(artifact)
		)
	) {
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

function buildCombinedAnswerText(toolResults: QueryAnswerToolResult[]): string {
	return toolResults
		.map((toolResult) => buildToolResultAnswerText(toolResult))
		.filter((answer) => answer.length > 0)
		.join(' ');
}

function buildToolResultAnswerText(toolResult: QueryAnswerToolResult): string {
	const result = toolResult.response.result;
	if (!result) {
		return '';
	}

	const synthesizedLookupAnswer = buildLookupAnswerText(toolResult);
	if (synthesizedLookupAnswer) {
		return synthesizedLookupAnswer;
	}

	return buildAnswerText(result.summary, result.rows.length);
}

function buildLookupAnswerText(toolResult: QueryAnswerToolResult): string | null {
	const resolvedQuery = toolResult.response.provenance.resolvedQuery;
	const result = toolResult.response.result;
	if (!resolvedQuery || !result) {
		return null;
	}

	if (resolvedQuery.operation !== 'lookup' || result.shape !== 'table' || result.rows.length !== 1) {
		return null;
	}

	const row = result.rows[0];
	if (!row) {
		return null;
	}

	const subjectName =
		typeof row.playerName === 'string'
			? row.playerName
			: typeof row.teamName === 'string'
				? row.teamName
				: resolvedQuery.subject.names?.[0];
	if (!subjectName) {
		return null;
	}

	const metricPhrases = resolvedQuery.metrics
		.map((metricId) => {
			const value = row[metricId];
			if (typeof value !== 'number' && typeof value !== 'string') {
				return null;
			}

			return formatMetricPhrase(metricId, value);
		})
		.filter((phrase): phrase is string => phrase !== null);
	if (metricPhrases.length === 0) {
		return null;
	}

	const season =
		typeof row.season === 'string' && row.season.trim().length > 0
			? row.season.trim()
			: resolvedQuery.filters.season ?? 'the current';
	const seasonType =
		typeof row.seasonType === 'string' && row.seasonType.trim().length > 0
			? row.seasonType.trim().toLowerCase()
			: resolvedQuery.filters.seasonType?.trim().toLowerCase() ?? 'season';

	if (resolvedQuery.entity === 'player') {
		return `${subjectName} averaged ${joinPhrases(metricPhrases)} in the ${season} ${seasonType}.`;
	}

	return `The ${subjectName} finished the ${season} ${seasonType} with ${joinPhrases(metricPhrases)}.`;
}

function formatMetricPhrase(metricId: string, value: number | string): string {
	switch (metricId) {
		case 'pts':
			return `${value} points`;
		case 'reb':
			return `${value} rebounds`;
		case 'ast':
			return `${value} assists`;
		case 'wins':
			return `${value} wins`;
		case 'losses':
			return `${value} losses`;
		case 'win_pct':
			return `a win percentage of ${value}`;
		case 'ortg':
			return `an offensive rating of ${value}`;
		case 'drtg':
			return `a defensive rating of ${value}`;
		default: {
			const definition = getMetricById(metricId);
			const label = definition?.aliases.at(-1) ?? definition?.aliases[0] ?? metricId;
			return `${value} ${label}`;
		}
	}
}

function joinPhrases(parts: string[]): string {
	if (parts.length === 1) {
		return parts[0] ?? '';
	}

	if (parts.length === 2) {
		return `${parts[0]} and ${parts[1]}`;
	}

	return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}
