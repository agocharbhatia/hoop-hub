import type { DynamicAgentAdapter, DynamicAgentCompletionInput } from '$lib/server/agent/types';
import { BetaError, getBetaConfig, setting } from './config';
import { currentPrincipal, withPrincipal } from './context';
import { BetaStore, getBetaStore } from './store';

const activeResearch = new Set<string>();
let activeModelCalls = 0;

/** Hold the permit until the underlying work settles, including after a streaming disconnect. */
export function admitResearch(store: BetaStore = getBetaStore(), now = Date.now()) {
	const principal = currentPrincipal();
	if (principal?.mode !== 'invite') return { run: <T>(work: () => T) => work(), release() {} };
	const config = getBetaConfig();
	if (activeResearch.has(principal.userId)) throw new BetaError('Your previous research is still finishing. Please wait a moment.', 429, 'research_running', 5);
	if (activeResearch.size >= config.concurrentResearch) throw new BetaError('All research slots are busy. Try again shortly.', 429, 'research_busy', 10);
	const day = utcDay(now);
	const minute = Math.floor(now / 60_000);
	store.db.transaction(() => {
		store.consumeCounter(`research-minute:${principal.userId}:${minute}`, config.researchPerMinute, (minute + 1) * 60_000, now);
		store.consumeCounter(`research-day:${principal.userId}:${day}`, config.researchPerDay, nextDay(now), now);
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
	if (principal?.mode !== 'invite') return;
	store.consumeCounter(`export-day:${principal.userId}:${utcDay(now)}`, getBetaConfig().exportsPerDay, nextDay(now), now);
}

/** Reserve a conservative upper cost before contacting the model; pending calls count after restart. */
export function budgetModel(model: DynamicAgentAdapter, options: { store?: BetaStore; nowMs?: () => number; maxOutputTokens?: number } = {}): DynamicAgentAdapter {
	return {
		supportsDirectFinalAnswer: model.supportsDirectFinalAnswer,
		async complete(input) {
			const principal = currentPrincipal();
			if (principal?.mode !== 'invite') return model.complete(input);
			if (!principal.runId) throw new BetaError('Research admission is required.', 503, 'admission_required');
			const runId = principal.runId;
			const store = options.store ?? getBetaStore();
			const rates = readModelRates();
			const now = options.nowMs?.() ?? Date.now();
			const reserve = estimateReservation(input, rates, options.maxOutputTokens ?? 4096);
			const id = crypto.randomUUID();
			const config = getBetaConfig();
			if (activeModelCalls >= config.concurrentResearch) throw new BetaError('The answer service is busy. Please retry shortly.', 429, 'model_busy', 5);
			store.db.transaction(() => {
				const totals = spendTotals(store, utcDay(now), principal.userId, runId);
				if (totals.global + reserve > micros(config.globalBudgetUsd)) throw new BetaError('Today’s beta research budget is used up. Research resumes tomorrow (UTC).', 429, 'global_budget', Math.ceil((nextDay(now) - now) / 1000));
				if (totals.user + reserve > micros(config.userBudgetUsd)) throw new BetaError('You have reached today’s research allowance. It resets at midnight UTC.', 429, 'user_budget', Math.ceil((nextDay(now) - now) / 1000));
				if (totals.run + reserve > micros(config.queryBudgetUsd)) throw new BetaError('This question reached its research budget. Try a narrower question.', 429, 'query_budget');
				store.db.query('INSERT INTO beta_model_charges(id,user_id,run_id,day,reserved_micros,created_at) VALUES (@id,@userId,@runId,@day,@reserve,@now)')
					.run({ id, userId: principal.userId, runId, day: utcDay(now), reserve, now });
			}).immediate();
			const started = performance.now();
			activeModelCalls++;
			try {
				const result = await model.complete(input);
				const usage = result.usage;
				if (usage && Number.isSafeInteger(usage.inputTokens) && Number.isSafeInteger(usage.outputTokens) && usage.inputTokens >= 0 && usage.outputTokens >= 0) {
					const charged = Math.ceil(usage.inputTokens * rates.input + usage.outputTokens * rates.output);
					store.db.query('UPDATE beta_model_charges SET charged_micros=@charged WHERE id=@id').run({ charged, id });
					if (charged > reserve) console.error(JSON.stringify({ event: 'model_reservation_exceeded', requestId: principal.requestId }));
				}
				console.info(JSON.stringify({ event: 'model_completed', requestId: principal.requestId, durationMs: Math.round(performance.now() - started) }));
				return result;
			} catch (error) {
				// Unknown billed usage, cancellation and ambiguous transport failures retain the reservation.
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
		limited: principal?.mode === 'invite', resetsAt: new Date(nextDay(now)).toISOString(),
		research: { used: store.counter(`research-day:${principal?.userId ?? 'local'}:${day}`), limit: config.researchPerDay },
		exports: { used: store.counter(`export-day:${principal?.userId ?? 'local'}:${day}`), limit: config.exportsPerDay }
	};
}

/* Budget arithmetic helpers */
export function readModelRates(): { input: number; output: number } {
	if (!process.env.HOOP_HUB_MODEL_INPUT_USD_PER_MILLION || !process.env.HOOP_HUB_MODEL_OUTPUT_USD_PER_MILLION) throw new BetaError('The research service needs model pricing configured. Please contact your inviter.', 503, 'pricing_missing');
	if (process.env.HOOP_HUB_MODEL_PRICING_MODEL !== (process.env.OPENAI_AGENT_MODEL ?? process.env.OPENAI_PLANNER_MODEL)) throw new BetaError('Model pricing needs to match the configured model. Please contact your inviter.', 503, 'pricing_mismatch');
	const input = setting('HOOP_HUB_MODEL_INPUT_USD_PER_MILLION', 0, 0.000001, 1000);
	return { input: Math.max(input * 1.25, setting('HOOP_HUB_MODEL_CACHE_WRITE_USD_PER_MILLION', input * 1.25, 0.000001, 1000)), output: setting('HOOP_HUB_MODEL_OUTPUT_USD_PER_MILLION', 0, 0.000001, 1000) };
}
function estimateReservation(input: DynamicAgentCompletionInput, rates: { input: number; output: number }, maxOutput: number): number {
	// UTF-8 bytes bound text tokens; padding covers protocol framing and schema serialization.
	const inputBound = Buffer.byteLength(JSON.stringify({ messages: input.messages, tools: input.tools, responseFormat: input.responseFormat })) + 8192;
	return Math.ceil(inputBound * rates.input + maxOutput * rates.output);
}
function spendTotals(store: BetaStore, day: string, userId: string, runId: string) {
	const current = store.db.query<{ global: number; user: number }>(`SELECT COALESCE(SUM(COALESCE(charged_micros,reserved_micros)),0) AS global,
		COALESCE(SUM(CASE WHEN user_id=@userId THEN COALESCE(charged_micros,reserved_micros) ELSE 0 END),0) AS user FROM beta_model_charges WHERE day=@day`).get({ day, userId })!;
	const run = store.db.query<{ total: number }, string>('SELECT COALESCE(SUM(COALESCE(charged_micros,reserved_micros)),0) AS total FROM beta_model_charges WHERE run_id=?').get(runId)!.total;
	return { ...current, run };
}
function micros(usd: number): number { return Math.floor(usd * 1_000_000); }
function utcDay(now: number): string { return new Date(now).toISOString().slice(0, 10); }
function nextDay(now: number): number { return (Math.floor(now / 86_400_000) + 1) * 86_400_000; }
/* End budget arithmetic helpers */
