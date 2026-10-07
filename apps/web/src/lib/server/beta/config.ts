export class BetaError extends Error {
	constructor(message: string, readonly status = 400, readonly code = 'invalid_request', readonly retryAfter = 0) { super(message); this.name = 'BetaError'; }
}

/** Invalid production settings stop admission instead of silently disabling a guard. */
export function getBetaConfig() {
	const mode = process.env.HOOP_HUB_AUTH_MODE ?? (process.env.NODE_ENV === 'production' ? 'invite' : 'local');
	if (mode !== 'invite' && mode !== 'local' && mode !== 'public') throw new Error('HOOP_HUB_AUTH_MODE must be invite, public or local.');
	return {
		mode,
		origin: process.env.ORIGIN ?? process.env.HOOP_HUB_APP_ORIGIN,
		// Zero leaves daily research unrestricted; admission still bounds request rate and concurrency.
		researchPerDay: setting('HOOP_HUB_RESEARCH_PER_DAY', 0, 0, 1000),
		researchPerMinute: setting('HOOP_HUB_RESEARCH_PER_MINUTE', 5, 1, 60),
		concurrentResearch: setting('HOOP_HUB_CONCURRENT_RESEARCH', 4, 1, 16),
		exportsPerDay: setting('HOOP_HUB_EXPORTS_PER_DAY', 3, 1, 100)
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
