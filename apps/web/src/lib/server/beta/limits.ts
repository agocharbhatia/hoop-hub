import type { DynamicAgentAdapter } from '$lib/server/agent/types';
import { BetaError, getBetaConfig } from './config';
import { currentPrincipal, withPrincipal } from './context';
import { BetaStore, getBetaStore } from './store';

const activeResearch = new Set<string>();
let activeModelCalls = 0;

/** Hold the permit until the underlying work settles, including after a streaming disconnect. */
export function admitResearch(store: BetaStore = getBetaStore(), now = Date.now()) {
	const principal = currentPrincipal();
	if (!principal || principal.mode === 'local') return { run: <T>(work: () => T) => work(), release() {} };
	const config = getBetaConfig();
	if (activeResearch.has(principal.userId)) throw new BetaError('Your previous research is still finishing. Please wait a moment.', 429, 'research_running', 5);
	if (activeResearch.size >= config.concurrentResearch) throw new BetaError('All research slots are busy. Try again shortly.', 429, 'research_busy', 10);
	const day = utcDay(now);
	const minute = Math.floor(now / 60_000);
	store.db.transaction(() => {
		store.consumeCounter(`research-minute:${principal.userId}:${minute}`, config.researchPerMinute, (minute + 1) * 60_000, now);
		if (config.researchPerDay > 0) store.consumeCounter(`research-day:${principal.userId}:${day}`, config.researchPerDay, nextDay(now), now);
	}).immediate();
	activeResearch.add(principal.userId);
	const runId = crypto.randomUUID();
	let released = false;
	return {
		run: <T>(work: () => T) => withPrincipal({ ...principal, runId }, work),
		release() { if (!released) { released = true; activeResearch.delete(principal.userId); } }
	};
}

export function admitExport(store: BetaStore = getBetaStore(), now = Date.now()): void {
	const principal = currentPrincipal();
	if (!principal || principal.mode === 'local') return;
	store.consumeCounter(`export-day:${principal.userId}:${utcDay(now)}`, getBetaConfig().exportsPerDay, nextDay(now), now);
}

/** Keep model concurrency bounded while preserving usage and timing for research traces. */
export function guardModel(model: DynamicAgentAdapter): DynamicAgentAdapter {
	return {
		supportsDirectFinalAnswer: model.supportsDirectFinalAnswer,
		async complete(input) {
			const principal = currentPrincipal();
			if (!principal || principal.mode === 'local') return model.complete(input);
			if (!principal.runId) throw new BetaError('Research admission is required.', 503, 'admission_required');
			if (activeModelCalls >= getBetaConfig().concurrentResearch) throw new BetaError('The answer service is busy. Please retry shortly.', 429, 'model_busy', 5);
			const started = performance.now();
			activeModelCalls++;
			try {
				const result = await model.complete(input);
				console.info(JSON.stringify({ event: 'model_completed', requestId: principal.requestId, durationMs: Math.round(performance.now() - started) }));
				return result;
			} catch (error) {
				console.info(JSON.stringify({ event: 'model_incomplete', requestId: principal.requestId, durationMs: Math.round(performance.now() - started) }));
				throw error;
			} finally { activeModelCalls--; }
		}
	};
}

export function usageSummary(store: BetaStore = getBetaStore(), now = Date.now()) {
	const principal = currentPrincipal();
	const config = getBetaConfig();
	const day = utcDay(now);
	return {
		limited: Boolean(principal && principal.mode !== 'local' && config.researchPerDay > 0), resetsAt: new Date(nextDay(now)).toISOString(),
		research: { used: store.counter(`research-day:${principal?.userId ?? 'local'}:${day}`), limit: config.researchPerDay },
		exports: { used: store.counter(`export-day:${principal?.userId ?? 'local'}:${day}`), limit: config.exportsPerDay }
	};
}

/* UTC quota window helpers */
function utcDay(now: number): string { return new Date(now).toISOString().slice(0, 10); }
function nextDay(now: number): number { return (Math.floor(now / 86_400_000) + 1) * 86_400_000; }
/* End UTC quota window helpers */
