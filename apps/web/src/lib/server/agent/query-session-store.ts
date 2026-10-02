import type { QueryEffectiveScope } from '$lib/contracts/query-context';
import type { GroundedResearchRequest, ResolvedResearchPlayer } from './research-context';

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

export type QuerySessionStore = ReturnType<typeof createQuerySessionStore>;
export const querySessionStore = createQuerySessionStore();

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
