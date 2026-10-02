import type { QueryEffectiveScope } from '$lib/contracts/query-context';
import type { GroundedResearchRequest, ResolvedResearchPlayer } from './research-context';
import { createResearchRepository, researchRepository, type ResearchRepository } from '$lib/server/research/repository';

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const MAX_STORED_SESSIONS = 100;
const MAX_CONTEXT_BYTES = 24_000;
const MAX_HISTORY_TURNS = 4;
const MAX_RESEARCH_REQUESTS = 12;

export type GroundedResearchContext = {
	questions: string[];
	requests: GroundedResearchRequest[];
	players: ResolvedResearchPlayer[];
	scope: QueryEffectiveScope;
};

export type QuerySession = { sessionId: string; context: GroundedResearchContext | null };

export class QuerySessionExpiredError extends Error {
	constructor() {
		super('This research session has expired. Start a new research question.');
		this.name = 'QuerySessionExpiredError';
	}
}

/** Keeps local research sessions bounded independently of the much larger diagnostic traces. */
export function createQuerySessionStore(options: { nowMs?: () => number; ttlMs?: number; maxSessions?: number } = {}) {
	const nowMs = options.nowMs ?? Date.now;
	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	const maxSessions = options.maxSessions ?? MAX_STORED_SESSIONS;
	const sessions = new Map<string, { context: GroundedResearchContext | null; touchedAt: number }>();

	return {
		load(sessionId?: string): QuerySession {
			pruneExpired(sessions, nowMs(), ttlMs);
			if (!sessionId) {
				return { sessionId: crypto.randomUUID(), context: null };
			}
			const stored = sessions.get(sessionId);
			if (!stored) throw new QuerySessionExpiredError();
			// Moving the entry maintains LRU eviction without sorting the entire store.
			sessions.delete(sessionId);
			sessions.set(sessionId, { ...stored, touchedAt: nowMs() });
			return { sessionId, context: structuredClone(stored.context) };
		},
		save(sessionId: string, context: GroundedResearchContext | null): boolean {
			if (context && context.requests.length > MAX_RESEARCH_REQUESTS) return false;
			const bounded = context ? {
				...context,
				questions: context.questions.slice(-MAX_HISTORY_TURNS),
				requests: context.requests,
				players: context.players.slice(0, 20)
			} : null;
			if (new TextEncoder().encode(JSON.stringify(bounded)).byteLength > MAX_CONTEXT_BYTES) return false;
			pruneExpired(sessions, nowMs(), ttlMs);
			sessions.delete(sessionId);
			sessions.set(sessionId, { context: structuredClone(bounded), touchedAt: nowMs() });
			while (sessions.size > maxSessions) {
				const oldest = sessions.keys().next().value;
				if (oldest === undefined) break;
				sessions.delete(oldest);
			}
			return true;
		}
	};
}

/** Reopening saved research restores only the small validated scope; display artifacts stay in durable history. */
export function createPersistentQuerySessionStore(options: { repository?: ResearchRepository; nowMs?: () => number; retentionDays?: number } = {}) {
	const repository = options.repository ?? (options.nowMs || options.retentionDays ? createResearchRepository(options) : researchRepository);
	return {
		load(sessionId?: string): QuerySession {
			if (!sessionId) return { sessionId: crypto.randomUUID(), context: null };
			const stored = repository.readSession(sessionId);
			if (!stored) throw new QuerySessionExpiredError();
			repository.writeContext(sessionId, stored.contextJson);
			return { sessionId, context: stored.contextJson ? JSON.parse(stored.contextJson) as GroundedResearchContext : null };
		},
		save(sessionId: string, context: GroundedResearchContext | null): boolean {
			if (context && context.requests.length > MAX_RESEARCH_REQUESTS) return false;
			const bounded = context ? { ...context, questions: context.questions.slice(-MAX_HISTORY_TURNS), players: context.players.slice(0, 20) } : null;
			const serialized = JSON.stringify(bounded);
			if (Buffer.byteLength(serialized) > MAX_CONTEXT_BYTES) return false;
			repository.writeContext(sessionId, bounded ? serialized : null);
			return true;
		},
		saveResult: repository.saveResult
	};
}

export type QuerySessionStore = ReturnType<typeof createQuerySessionStore> & { saveResult?: ResearchRepository['saveResult'] };
export const querySessionStore: QuerySessionStore = createPersistentQuerySessionStore();

/* Helper functions */

function pruneExpired(
	sessions: Map<string, { context: GroundedResearchContext | null; touchedAt: number }>,
	nowMs: number,
	ttlMs: number
): void {
	for (const [id, session] of sessions) {
		if (nowMs - session.touchedAt >= ttlMs) sessions.delete(id);
	}
}

/* End helper functions */
