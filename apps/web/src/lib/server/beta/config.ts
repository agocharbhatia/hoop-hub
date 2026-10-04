export class BetaError extends Error {
	constructor(message: string, readonly status = 400, readonly code = 'invalid_request', readonly retryAfter = 0) { super(message); this.name = 'BetaError'; }
}

/** Invalid production settings stop admission instead of silently disabling a guard. */
export function getBetaConfig() {
	const mode = process.env.HOOP_HUB_AUTH_MODE ?? (process.env.NODE_ENV === 'production' ? 'invite' : 'local');
	if (mode !== 'invite' && mode !== 'local') throw new Error('HOOP_HUB_AUTH_MODE must be invite or local.');
	return {
		mode,
		origin: process.env.ORIGIN ?? process.env.HOOP_HUB_APP_ORIGIN,
		researchPerDay: setting('HOOP_HUB_RESEARCH_PER_DAY', 30, 1, 1000),
		researchPerMinute: setting('HOOP_HUB_RESEARCH_PER_MINUTE', 5, 1, 60),
		concurrentResearch: setting('HOOP_HUB_CONCURRENT_RESEARCH', 4, 1, 16),
		exportsPerDay: setting('HOOP_HUB_EXPORTS_PER_DAY', 3, 1, 100),
		globalBudgetUsd: setting('HOOP_HUB_DAILY_BUDGET_USD', 5, 0.01, 1000),
		userBudgetUsd: setting('HOOP_HUB_USER_DAILY_BUDGET_USD', 0.5, 0.01, 100),
		queryBudgetUsd: setting('HOOP_HUB_QUERY_BUDGET_USD', 0.15, 0.001, 10)
	};
}

/* Configuration helpers */
export function setting(name: string, fallback: number, min: number, max: number): number {
	const source = process.env[name];
	if (!source) return fallback;
	const value = Number(source);
	if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name}.`);
	return value;
}
/* End configuration helpers */
