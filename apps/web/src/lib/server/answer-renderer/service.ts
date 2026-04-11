import type {
	QueryAnswerArtifact,
	QueryAnswerToolResult
} from '$lib/contracts/answer-response';
import type { StatsQueryWarning } from '$lib/contracts/semantic-query';
import { getMetricById } from '$lib/server/metrics/registry';

export type AnswerRendererInput = {
	question: string;
	toolResults: QueryAnswerToolResult[];
	warnings?: StatsQueryWarning[];
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

export type GroundedAnswerSynthesisInput = {
	question: string;
	toolResults: QueryAnswerToolResult[];
	warnings: StatsQueryWarning[];
};

export type GroundedAnswerSynthesisAdapter = {
	synthesizeAnswer(input: GroundedAnswerSynthesisInput): Promise<unknown>;
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
 * Provides the deterministic grounded fallback renderer used in tests and when the default LLM synthesis path is unavailable.
 */
export function createDeterministicAnswerRendererService(): AnswerRendererService {
	return createAnswerRendererService({
		async renderAnswer({ toolResults }) {
			const artifacts = buildArtifactsFromToolResults(toolResults);
			const primaryResponse = toolResults[0]?.response;

			if (artifacts.length === 0) {
				return {
					answer: primaryResponse?.warnings[0]?.message ?? 'Unable to answer this query.',
					artifacts: []
				};
			}

			return {
				answer: buildCombinedAnswerText(toolResults),
				artifacts
			};
		}
	});
}

/**
 * Provides the default route renderer: try grounded LLM synthesis first, then fall back to deterministic phrasing.
 */
export function createDefaultAnswerRendererService(options?: {
	synthesisAdapter?: GroundedAnswerSynthesisAdapter | null;
	fallbackRenderer?: AnswerRendererService;
}): AnswerRendererService {
	const fallbackRenderer = options?.fallbackRenderer ?? createDeterministicAnswerRendererService();
	let adapterResolution: Promise<GroundedAnswerSynthesisAdapter | null> | null = null;

	async function resolveAdapter(): Promise<GroundedAnswerSynthesisAdapter | null> {
		if (options && 'synthesisAdapter' in options) {
			return options.synthesisAdapter ?? null;
		}

		if (!adapterResolution) {
			adapterResolution = loadDefaultSynthesisAdapter();
		}

		return adapterResolution;
	}

	return createAnswerRendererService({
		async renderAnswer(input) {
			const artifacts = buildArtifactsFromToolResults(input.toolResults);
			if (artifacts.length === 0) {
				return fallbackRenderer.renderAnswer(input);
			}

			const adapter = await resolveAdapter();
			if (adapter) {
				try {
					const synthesized = await adapter.synthesizeAnswer({
						question: input.question,
						toolResults: input.toolResults,
						warnings: input.warnings ?? []
					});
					const validated = validateGroundedAnswerSynthesisOutput(synthesized);
					if (validated.ok) {
						return {
							answer: validated.value.answer,
							artifacts
						};
					}
				} catch {
					// Fall back to deterministic grounded phrasing when synthesis is unavailable or fails.
				}
			}

			const fallback = await fallbackRenderer.renderAnswer(input);
			return {
				answer: fallback.answer,
				artifacts
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

function validateGroundedAnswerSynthesisOutput(
	input: unknown
): { ok: true; value: { answer: string } } | { ok: false; error: string } {
	if (!isPlainObject(input) || typeof input.answer !== 'string' || input.answer.trim().length === 0) {
		return { ok: false, error: 'Grounded answer synthesis output must include a non-empty answer.' };
	}

	return {
		ok: true,
		value: {
			answer: input.answer.trim()
		}
	};
}

function buildArtifactsFromToolResults(toolResults: QueryAnswerToolResult[]): QueryAnswerArtifact[] {
	return toolResults
		.map((toolResult) => toolResult.response.result)
		.filter((result): result is NonNullable<QueryAnswerToolResult['response']['result']> => result !== null)
		.map((result) => ({
			type: 'table' as const,
			shape: result.shape,
			columns: result.columns,
			rows: result.rows
		}));
}

async function loadDefaultSynthesisAdapter(): Promise<GroundedAnswerSynthesisAdapter | null> {
	try {
		const { createOpenAIAnswerRendererAdapter } = await import('./openai-adapter');
		return createOpenAIAnswerRendererAdapter();
	} catch {
		return null;
	}
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

	const synthesizedStandingsAnswer = buildStandingsAnswerText(toolResult);
	if (synthesizedStandingsAnswer) {
		return synthesizedStandingsAnswer;
	}

	const synthesizedGameAnswer = buildGameAnswerText(toolResult);
	if (synthesizedGameAnswer) {
		return synthesizedGameAnswer;
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

function buildStandingsAnswerText(toolResult: QueryAnswerToolResult): string | null {
	const resolvedQuery = toolResult.response.provenance.resolvedQuery;
	const result = toolResult.response.result;
	if (!resolvedQuery || !result || resolvedQuery.operation !== 'standings') {
		return null;
	}

	if (result.shape === 'table' && result.rows.length === 1) {
		const row = result.rows[0];
		if (!row) {
			return null;
		}

		const teamName =
			typeof row.teamName === 'string' && row.teamName.trim().length > 0
				? row.teamName.trim()
				: resolvedQuery.subject.names?.[0];
		if (!teamName) {
			return null;
		}

		const metricPhrases = buildStandingsMetricPhrases(resolvedQuery.metrics, row);
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
		const isHistoricalSeason = Boolean(resolvedQuery.filters.season);

		return isHistoricalSeason
			? `In the ${season} ${seasonType}, the ${teamName} finished with ${joinPhrases(metricPhrases)}.`
			: `In the ${season} ${seasonType}, the ${teamName} have ${joinPhrases(metricPhrases)}.`;
	}

	if (result.shape === 'ranking' && result.rows.length > 0) {
		const leader = result.rows[0];
		const subject = typeof leader?.subject === 'string' ? leader.subject : null;
		const metric = typeof leader?.metric === 'string' ? leader.metric : null;
		const value = leader?.value;
		if (!subject || !metric || (typeof value !== 'number' && typeof value !== 'string')) {
			return null;
		}

		const season = resolvedQuery.filters.season ?? 'this season';
		const conference = resolvedQuery.filters.conference ? ` in the ${resolvedQuery.filters.conference}` : '';
		const division = resolvedQuery.filters.division ? ` in the ${resolvedQuery.filters.division} Division` : '';

		if (metric === 'conference_rank' || metric === 'seed') {
			if (value === 1) {
				return `${subject} are first${conference}${division} for ${season}.`;
			}

			return `${subject} are ranked ${value}${conference}${division} for ${season}.`;
		}

		if (metric === 'streak') {
			const streakPhrase = formatStreakPhrase(value);
			if (!streakPhrase) {
				return `${subject} have the longest current streak${conference}${division} for ${season}.`;
			}

			return `${subject} have the longest current streak${conference}${division} for ${season}: ${streakPhrase}.`;
		}

		return `${subject} lead${conference}${division} in ${formatMetricLabel(metric)} for ${season} at ${value}.`;
	}

	return null;
}

function buildGameAnswerText(toolResult: QueryAnswerToolResult): string | null {
	const resolvedQuery = toolResult.response.provenance.resolvedQuery;
	const result = toolResult.response.result;
	if (!resolvedQuery || !result || resolvedQuery.operation !== 'game') {
		return null;
	}

	const teamName = resolvedQuery.subject.names?.[0];
	if (!teamName) {
		return null;
	}
	const hasExactDate =
		typeof resolvedQuery.filters.dateFrom === 'string' &&
		resolvedQuery.filters.dateFrom.length > 0 &&
		resolvedQuery.filters.dateFrom === resolvedQuery.filters.dateTo;
	const hasBoundedRange =
		typeof resolvedQuery.filters.dateFrom === 'string' &&
		resolvedQuery.filters.dateFrom.length > 0 &&
		typeof resolvedQuery.filters.dateTo === 'string' &&
		resolvedQuery.filters.dateTo.length > 0 &&
		resolvedQuery.filters.dateFrom !== resolvedQuery.filters.dateTo;

	if (result.rows.length === 0) {
		const exactDate =
			typeof resolvedQuery.filters.dateFrom === 'string' &&
			resolvedQuery.filters.dateFrom.length > 0 &&
			resolvedQuery.filters.dateFrom === resolvedQuery.filters.dateTo
				? resolvedQuery.filters.dateFrom
				: null;

		if (resolvedQuery.filters.gameStatus === 'final') {
			return `${teamName} did not play on ${exactDate ?? 'the requested recent date'}.`;
		}

		if (resolvedQuery.filters.gameStatus === 'upcoming') {
			return `${teamName} do not have a grounded upcoming game in the current materialized window.`;
		}

		return buildAnswerText(result.summary, 0);
	}

	if (result.rows.length === 1) {
		const row = result.rows[0];
		if (!row) {
			return null;
		}

		const opponent = typeof row.opponent_team === 'string' ? row.opponent_team : null;
		const gameDate = typeof row.game_date === 'string' ? row.game_date : null;
		const gameStatus = row.game_status;
		const teamScore = typeof row.team_score === 'number' ? row.team_score : null;
		const opponentScore = typeof row.opponent_score === 'number' ? row.opponent_score : null;
		const resultCode = typeof row.result === 'string' ? row.result : null;

		if (gameStatus === 'upcoming' && opponent && gameDate) {
			if (hasBoundedRange) {
				return `${teamName} play the ${opponent} on ${gameDate} in the requested range.`;
			}

			if (hasExactDate) {
				return `${teamName} play the ${opponent} on ${gameDate}.`;
			}

			return `${teamName} play the ${opponent} next on ${gameDate}.`;
		}

		if (gameStatus === 'final' && opponent && gameDate) {
			const gamePrefix = hasBoundedRange ? `In the requested range, ${teamName}` : teamName;
			if (resultCode === 'W' && teamScore !== null && opponentScore !== null) {
				return `${gamePrefix} beat the ${opponent} ${teamScore}-${opponentScore} on ${gameDate}.`;
			}

			if (resultCode === 'L' && teamScore !== null && opponentScore !== null) {
				return `${gamePrefix} lost to the ${opponent} ${teamScore}-${opponentScore} on ${gameDate}.`;
			}

			return `${gamePrefix} played the ${opponent} on ${gameDate}.`;
		}
	}

	if (resolvedQuery.filters.gameStatus === 'upcoming') {
		return `${teamName} have ${result.rows.length} grounded upcoming game${result.rows.length === 1 ? '' : 's'} in the returned range.`;
	}

	if (resolvedQuery.filters.gameStatus === 'final') {
		return `${teamName} have ${result.rows.length} grounded recent result${result.rows.length === 1 ? '' : 's'} in the returned range.`;
	}

	return buildAnswerText(result.summary, result.rows.length);
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

function formatStandingsMetricPhrase(metricId: string, value: number | string): string | null {
	switch (metricId) {
		case 'seed':
			return `the No. ${value} seed`;
		case 'conference_rank':
			return formatConferenceRankPhrase(value);
		case 'wins':
			return `${value} wins`;
		case 'losses':
			return `${value} losses`;
		case 'win_pct':
			return `a ${formatWinPct(value)} win percentage`;
		case 'games_back':
			return `${value} games back`;
		case 'streak':
			return formatStreakPhrase(value);
		default:
			return formatMetricPhrase(metricId, value);
	}
}

function formatConferenceRankPhrase(value: number | string): string {
	const numericValue = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
	if (!Number.isFinite(numericValue)) {
		return `${value} in their conference`;
	}

	if (numericValue === 1) {
		return 'first in their conference';
	}

	return `${formatOrdinal(numericValue)} in their conference`;
}

function formatOrdinal(value: number): string {
	const remainderHundred = value % 100;
	if (remainderHundred >= 11 && remainderHundred <= 13) {
		return `${value}th`;
	}

	const remainderTen = value % 10;
	if (remainderTen === 1) {
		return `${value}st`;
	}
	if (remainderTen === 2) {
		return `${value}nd`;
	}
	if (remainderTen === 3) {
		return `${value}rd`;
	}

	return `${value}th`;
}

function buildStandingsMetricPhrases(metrics: string[], row: Record<string, unknown>): string[] {
	const phrases: string[] = [];
	const metricSet = new Set(metrics);
	const wins = row.wins;
	const losses = row.losses;

	if (metricSet.has('wins') && metricSet.has('losses') && typeof wins === 'number' && typeof losses === 'number') {
		phrases.push(`${wins} wins and ${losses} losses`);
	}

	for (const metricId of metrics) {
		if ((metricId === 'wins' || metricId === 'losses') && metricSet.has('wins') && metricSet.has('losses')) {
			continue;
		}

		const value = row[metricId];
		if (typeof value !== 'number' && typeof value !== 'string') {
			continue;
		}

		const phrase = formatStandingsMetricPhrase(metricId, value);
		if (phrase) {
			phrases.push(phrase);
		}
	}

	return phrases;
}

function formatWinPct(value: number | string): string {
	const numericValue = typeof value === 'number' ? value : Number.parseFloat(String(value));
	if (!Number.isFinite(numericValue)) {
		return String(value);
	}

	return numericValue.toFixed(3).replace(/^0/, '');
}

function parseStreakValue(value: number | string): { direction: 'W' | 'L'; length: number } | null {
	const normalizedValue = String(value).trim().toUpperCase();
	const match = normalizedValue.match(/^([WL])\s*(\d+)$/);
	if (!match) {
		return null;
	}

	const length = Number.parseInt(match[2] ?? '', 10);
	if (!Number.isFinite(length) || length <= 0) {
		return null;
	}

	return {
		direction: (match[1] as 'W' | 'L') ?? 'W',
		length
	};
}

function formatStreakPhrase(value: number | string): string | null {
	const streak = parseStreakValue(value);
	if (!streak) {
		return null;
	}

	const directionLabel = streak.direction === 'W' ? 'winning' : 'losing';
	return `a ${streak.length}-game ${directionLabel} streak`;
}

function formatMetricLabel(metricId: string): string {
	const definition = getMetricById(metricId);
	return definition?.aliases.at(-1) ?? definition?.aliases[0] ?? metricId.replaceAll('_', ' ');
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
