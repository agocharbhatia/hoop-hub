import {
	MAX_BATCH_TOOL_REQUESTS,
	type BatchPlannerDecision,
	type PlannerWarningCode,
	type QueryPlannerToolRequest
} from '$lib/contracts/planner';
import type {
	SemanticQuery,
	SemanticQueryEntity,
	SemanticQueryOperation,
	SemanticQuerySubject
} from '$lib/contracts/semantic-query';
import { validateSemanticCapabilityQueryShape } from '$lib/server/semantic/capabilities';

export type PlannerAdapter = {
	planQuestion(question: string): Promise<unknown>;
};

export type PlannerService = {
	planQuestion(question: string): Promise<BatchPlannerDecision>;
};

/**
 * Validates planner output before any executor call so model drift cannot bypass the typed runtime boundary.
 */
export function createPlannerService(adapter: PlannerAdapter): PlannerService {
	async function planWithOptionalRecovery(
		question: string,
		options?: { allowRecovery?: boolean }
	): Promise<BatchPlannerDecision> {
		const output = await adapter.planQuestion(question);
		const validated = validatePlannerDecision(output);
		if (!validated.ok) {
			throw new Error(validated.error);
		}

		const normalized = normalizePlannerDecision(validated.value);
		if (normalized.type === 'planned' && normalized.toolRequests.length > MAX_BATCH_TOOL_REQUESTS) {
			return {
				type: 'clarification_needed',
				warning: {
					code: 'clarification_needed',
					message: `This question would require more than ${MAX_BATCH_TOOL_REQUESTS} tool requests. Ask a narrower question that needs up to ${MAX_BATCH_TOOL_REQUESTS}.`
				}
			};
		}

		if (options?.allowRecovery !== false) {
			const recovered = await recoverMixedSupportedQuestion(question, normalized, adapter);
			if (recovered) {
				return recovered;
			}
		}

		return normalized;
	}

	return {
		async planQuestion(question: string): Promise<BatchPlannerDecision> {
			return planWithOptionalRecovery(question);
		}
	};
}

/* Helper functions */

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function normalizeSeasonFilter(season: SemanticQuery['filters']['season']): SemanticQuery['filters']['season'] {
	if (season === null || season === undefined) {
		return null;
	}

	const normalizedSeason = season.trim().toLowerCase();
	if (normalizedSeason.length === 0) {
		return null;
	}

	if (
		normalizedSeason === 'this season' ||
		normalizedSeason === 'current season' ||
		normalizedSeason === 'this nba season' ||
		normalizedSeason === 'current nba season' ||
		normalizedSeason === 'this year'
	) {
		return null;
	}

	const slashFormatMatch = normalizedSeason.match(/^(\d{4})\s*[/-]\s*(\d{2}|\d{4})$/);
	if (!slashFormatMatch) {
		return season.trim();
	}

	const [, startYear, endYear] = slashFormatMatch;
	return `${startYear}-${endYear.slice(-2)}`;
}

function normalizePlannerDecision(decision: BatchPlannerDecision): BatchPlannerDecision {
	if (decision.type !== 'planned') {
		return decision;
	}

	return {
		type: 'planned',
		toolRequests: decision.toolRequests.map((toolRequest) => ({
			...toolRequest,
			query: {
				...toolRequest.query,
				filters: {
					...toolRequest.query.filters,
					season: normalizeSeasonFilter(toolRequest.query.filters.season)
				}
			}
		})),
		warnings: decision.warnings ?? []
	};
}

function buildQuotedQuestion(question: string): string {
	return `"${question.trim()}"`;
}

function normalizeQuestionWhitespace(question: string): string {
	return question.replace(/\s+/g, ' ').trim();
}

function ensureQuestionMark(question: string, referenceQuestion: string): string {
	if (!referenceQuestion.trim().endsWith('?')) {
		return question;
	}

	return question.endsWith('?') ? question : `${question}?`;
}

function splitQuestionIntoClauses(question: string): string[] {
	return normalizeQuestionWhitespace(question)
		.split(/\s*,\s*|\s+and\s+/i)
		.map((clause) => clause.trim())
		.filter((clause) => clause.length > 0);
}

function isUnsupportedPredictionClause(clause: string): boolean {
	return /\b(who will win|will win|going to win|gonna win|prediction|predict|should i bet|bet on)\b/i.test(clause);
}

async function recoverMixedSupportedQuestion(
	question: string,
	decision: BatchPlannerDecision,
	adapter: PlannerAdapter
): Promise<BatchPlannerDecision | null> {
	if (decision.type !== 'coverage_gap' || decision.warning.code !== 'unsupported_query_shape') {
		return null;
	}

	const clauses = splitQuestionIntoClauses(question);
	const supportedClauses = clauses.filter((clause) => !isUnsupportedPredictionClause(clause));
	if (supportedClauses.length === 0 || supportedClauses.length === clauses.length) {
		return null;
	}

	const reducedQuestion = ensureQuestionMark(supportedClauses.join(' and '), question);
	const recoveryOutput = await adapter.planQuestion(reducedQuestion);
	const validated = validatePlannerDecision(recoveryOutput);
	if (!validated.ok) {
		return null;
	}

	const normalized = normalizePlannerDecision(validated.value);
	if (normalized.type !== 'planned') {
		return null;
	}

	return {
		...normalized,
		warnings: [
			...(normalized.warnings ?? []),
			{
				code: 'dropped_unsupported_clause',
				message: `Dropped the unsupported prediction part of ${buildQuotedQuestion(question)} and answered the supported standings/game parts instead.`
			}
		]
	};
}

function countSubjectValues(subject: SemanticQuery['subject']): number {
	return (subject.names?.length ?? 0) + (subject.ids?.length ?? 0);
}

function validateWindow(window: unknown): boolean {
	if (window === null || window === undefined) {
		return true;
	}

	if (!isPlainObject(window)) {
		return false;
	}

	if (window.type !== 'last_n_games') {
		return false;
	}

	const n = typeof window.n === 'number' ? window.n : Number.NaN;
	return Number.isInteger(n) && n > 0;
}

function validateFilters(filters: unknown): filters is SemanticQuery['filters'] {
	if (!isPlainObject(filters)) {
		return false;
	}

	const season = filters.season;
	if (season !== null && season !== undefined && typeof season !== 'string') {
		return false;
	}

	if (!validateWindow(filters.window)) {
		return false;
	}

	if (filters.dateFrom !== null && filters.dateFrom !== undefined && typeof filters.dateFrom !== 'string') {
		return false;
	}

	if (filters.dateTo !== null && filters.dateTo !== undefined && typeof filters.dateTo !== 'string') {
		return false;
	}

	if (filters.seasonType !== null && filters.seasonType !== undefined && typeof filters.seasonType !== 'string') {
		return false;
	}

	if (
		filters.conference !== null &&
		filters.conference !== undefined &&
		filters.conference !== 'East' &&
		filters.conference !== 'West'
	) {
		return false;
	}

	if (
		filters.division !== null &&
		filters.division !== undefined &&
		filters.division !== 'Atlantic' &&
		filters.division !== 'Central' &&
		filters.division !== 'Southeast' &&
		filters.division !== 'Northwest' &&
		filters.division !== 'Pacific' &&
		filters.division !== 'Southwest'
	) {
		return false;
	}

	if (
		filters.gameStatus !== null &&
		filters.gameStatus !== undefined &&
		filters.gameStatus !== 'upcoming' &&
		filters.gameStatus !== 'final' &&
		filters.gameStatus !== 'any'
	) {
		return false;
	}

	return true;
}

function validateSemanticQueryShape(query: unknown): query is SemanticQuery {
	if (!isPlainObject(query)) {
		return false;
	}

	if (!isStringArray(query.metrics) || query.metrics.length === 0) {
		return false;
	}

	if (!validateFilters(query.filters)) {
		return false;
	}

	if (!isPlainObject(query.subject)) {
		return false;
	}

	const names = query.subject.names;
	const ids = query.subject.ids;
	if ((names !== undefined && !isStringArray(names)) || (ids !== undefined && !isStringArray(ids))) {
		return false;
	}

	const subject = query.subject as SemanticQuery['subject'];
	const subjectCount = countSubjectValues(subject);
	if (
		(query.operation === 'lookup' && subjectCount !== 1) ||
		(query.operation === 'rank' && query.entity === 'player' && subjectCount !== 0) ||
		(query.operation === 'rank' && query.entity === 'team' && subjectCount > 1) ||
		(query.operation === 'trend' && subjectCount !== 1) ||
		(query.operation === 'compare' && subjectCount !== 2)
	) {
		return false;
	}

	if (query.orderBy !== null && query.orderBy !== undefined) {
		if (!isPlainObject(query.orderBy)) {
			return false;
		}
		if (typeof query.orderBy.metric !== 'string') {
			return false;
		}
		if (query.orderBy.direction !== 'asc' && query.orderBy.direction !== 'desc') {
			return false;
		}
	}

	if (query.limit !== null && query.limit !== undefined) {
		const limit = typeof query.limit === 'number' ? query.limit : Number.NaN;
		if (!Number.isInteger(limit) || limit < 1) {
			return false;
		}
	}

	if (
		query.outputMode !== null &&
		query.outputMode !== undefined &&
		query.outputMode !== 'table' &&
		query.outputMode !== 'summary' &&
		query.outputMode !== 'timeseries' &&
		query.outputMode !== 'comparison'
	) {
		return false;
	}

	if (query.entity === 'team' && query.operation === 'rank' && query.metrics.length !== 1) {
		return false;
	}

	if (query.entity === 'team' && query.operation === 'rank' && query.orderBy?.metric !== query.metrics[0]) {
		return false;
	}

	if (query.operation === 'compare' && query.outputMode !== 'comparison') {
		return false;
	}

	if (
		query.entity === 'team' &&
		query.operation !== 'rank' &&
		query.operation !== 'lookup' &&
		query.operation !== 'standings' &&
		query.operation !== 'game'
	) {
		return false;
	}

	const normalizedQuery: SemanticQuery = {
		...(query as SemanticQuery),
		filters: {
			...query.filters,
			season: normalizeSeasonFilter(query.filters.season)
		}
	};

	return validateSemanticCapabilityQueryShape({
		operation: normalizedQuery.operation as SemanticQueryOperation,
		entity: normalizedQuery.entity as SemanticQueryEntity,
		subject: normalizedQuery.subject as SemanticQuerySubject,
		metrics: normalizedQuery.metrics,
		filters: normalizedQuery.filters,
		outputMode: normalizedQuery.outputMode
	}).ok;
}

function validatePlannerToolRequest(input: unknown): input is QueryPlannerToolRequest {
	return isPlainObject(input) && input.toolName === 'stats_query' && validateSemanticQueryShape(input.query);
}

function isSupportedPlannerWarningCode(code: unknown): code is PlannerWarningCode {
	return (
		code === 'unsupported_query_shape' ||
		code === 'unsupported_metric' ||
		code === 'clarification_needed' ||
		code === 'missing_metric' ||
		code === 'compare_requires_two_subjects' ||
		code === 'dropped_unsupported_clause'
	);
}

function validatePlannerDecision(
	input: unknown
): { ok: true; value: BatchPlannerDecision } | { ok: false; error: string } {
	if (!isPlainObject(input)) {
		return { ok: false, error: 'Planner output must be an object.' };
	}

	if (input.type === 'planned') {
		if (!Array.isArray(input.toolRequests) || input.toolRequests.length === 0) {
			return { ok: false, error: 'Planner planned toolRequests failed validation.' };
		}

		if (!input.toolRequests.every((toolRequest) => validatePlannerToolRequest(toolRequest))) {
			return { ok: false, error: 'Planner planned toolRequests failed validation.' };
		}

		if (
			(input.warnings !== null &&
				input.warnings !== undefined &&
				!Array.isArray(input.warnings)) ||
			(input.warnings !== null &&
				input.warnings !== undefined &&
			!input.warnings.every(
				(warning) =>
					isPlainObject(warning) &&
					isSupportedPlannerWarningCode(warning.code) &&
					typeof warning.message === 'string' &&
					warning.message.trim().length > 0
			))
		) {
			return { ok: false, error: 'Planner planned warnings failed validation.' };
		}

		return {
			ok: true,
			value: {
				type: 'planned',
				toolRequests: input.toolRequests,
				warnings: input.warnings ?? []
			}
		};
	}

	if (input.type === 'coverage_gap' || input.type === 'clarification_needed') {
		if (!isPlainObject(input.warning)) {
			return { ok: false, error: 'Planner non-ok decisions require a warning object.' };
		}

		const warningCode = input.warning.code;
		if (typeof warningCode !== 'string' || warningCode.trim().length === 0) {
			return { ok: false, error: 'Planner warnings require a code.' };
		}

		if (typeof input.warning.message !== 'string' || input.warning.message.trim().length === 0) {
			return { ok: false, error: 'Planner warnings require a message.' };
		}

		if (!isSupportedPlannerWarningCode(warningCode)) {
			return { ok: false, error: 'Planner warning code is not supported.' };
		}

		return {
			ok: true,
			value: {
				type: input.type,
				warning: {
					code: warningCode,
					message: input.warning.message
				}
			}
		};
	}

	return { ok: false, error: 'Planner output type is not supported.' };
}
