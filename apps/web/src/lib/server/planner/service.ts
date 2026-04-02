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

function validateSemanticQueryShape(query: unknown): query is SemanticQuery {
	if (!isPlainObject(query)) {
		return false;
	}

	if (query.operation !== 'rank' || query.entity !== 'player') {
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

	if ((names?.length ?? 0) > 0 || (ids?.length ?? 0) > 0) {
		return false;
	}

	if (!isStringArray(query.metrics) || query.metrics.length === 0) {
		return false;
	}

	if (!isPlainObject(query.filters)) {
		return false;
	}

	const season = query.filters.season;
	if (season !== null && season !== undefined && typeof season !== 'string') {
		return false;
	}

	if (query.filters.window !== null && query.filters.window !== undefined) {
		return false;
	}

	if (query.filters.dateFrom !== null && query.filters.dateFrom !== undefined) {
		return false;
	}

	if (query.filters.dateTo !== null && query.filters.dateTo !== undefined) {
		return false;
	}

	if (query.filters.seasonType !== null && query.filters.seasonType !== undefined && typeof query.filters.seasonType !== 'string') {
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
			input.warning.code !== 'clarification_needed'
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
