import type { PlannerDecision } from '$lib/contracts/planner';
import type { SemanticQuery } from '$lib/contracts/semantic-query';

export type PlannerAdapter = {
	planQuestion(question: string): Promise<unknown>;
};

export type PlannerService = {
	planQuestion(question: string): Promise<PlannerDecision>;
};

/**
 * Validates planner output before any executor call so model drift cannot bypass the typed runtime boundary.
 */
export function createPlannerService(adapter: PlannerAdapter): PlannerService {
	return {
		async planQuestion(question: string): Promise<PlannerDecision> {
			const output = await adapter.planQuestion(question);
			const validated = validatePlannerDecision(output);
			if (!validated.ok) {
				throw new Error(validated.error);
			}

			return validated.value;
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

function validateSubject(
	subject: unknown,
	requirement: 'empty' | 'non_empty'
): subject is SemanticQuery['subject'] {
	if (!isPlainObject(subject)) {
		return false;
	}

	const names = subject.names;
	const ids = subject.ids;
	if ((names !== undefined && !isStringArray(names)) || (ids !== undefined && !isStringArray(ids))) {
		return false;
	}

	const subjectCount = (names?.length ?? 0) + (ids?.length ?? 0);
	if (requirement === 'empty') {
		return subjectCount === 0;
	}

	return subjectCount > 0;
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

	if (filters.dateFrom !== null && filters.dateFrom !== undefined) {
		return false;
	}

	if (filters.dateTo !== null && filters.dateTo !== undefined) {
		return false;
	}

	if (filters.seasonType !== null && filters.seasonType !== undefined && typeof filters.seasonType !== 'string') {
		return false;
	}

	return true;
}

function validateSemanticQueryShape(query: unknown): query is SemanticQuery {
	if (!isPlainObject(query)) {
		return false;
	}

	if (query.entity !== 'player') {
		return false;
	}

	if (query.operation !== 'rank' && query.operation !== 'trend') {
		return false;
	}

	if (!isStringArray(query.metrics) || query.metrics.length === 0) {
		return false;
	}

	if (!validateFilters(query.filters)) {
		return false;
	}

	if (
		(query.operation === 'rank' && !validateSubject(query.subject, 'empty')) ||
		(query.operation === 'trend' && !validateSubject(query.subject, 'non_empty'))
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

	return true;
}

function validatePlannerDecision(input: unknown): { ok: true; value: PlannerDecision } | { ok: false; error: string } {
	if (!isPlainObject(input)) {
		return { ok: false, error: 'Planner output must be an object.' };
	}

	if (input.type === 'planned') {
		if (!validateSemanticQueryShape(input.query)) {
			return { ok: false, error: 'Planner planned query failed validation.' };
		}

		return {
			ok: true,
			value: {
				type: 'planned',
				query: input.query
			}
		};
	}

	if (input.type === 'coverage_gap' || input.type === 'clarification_needed') {
		if (!isPlainObject(input.warning)) {
			return { ok: false, error: 'Planner non-ok decisions require a warning object.' };
		}

		if (typeof input.warning.code !== 'string' || input.warning.code.trim().length === 0) {
			return { ok: false, error: 'Planner warnings require a code.' };
		}

		if (typeof input.warning.message !== 'string' || input.warning.message.trim().length === 0) {
			return { ok: false, error: 'Planner warnings require a message.' };
		}

		if (
			input.warning.code !== 'unsupported_query_shape' &&
			input.warning.code !== 'unsupported_metric' &&
			input.warning.code !== 'clarification_needed' &&
			input.warning.code !== 'missing_metric'
		) {
			return { ok: false, error: 'Planner warning code is not supported.' };
		}

		return {
			ok: true,
			value: {
				type: input.type,
				warning: {
					code: input.warning.code,
					message: input.warning.message
				}
			}
		};
	}

	return { ok: false, error: 'Planner output type is not supported.' };
}
