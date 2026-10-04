import { currentOwnerId } from '$lib/server/beta/context';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
import { RESEARCH_RETENTION_DAYS, type SavedResearchDetail, type SavedResearchList, type SavedResearchResponse, type SavedResearchSummary, type SavedResearchTurn } from '$lib/contracts/research-contract';
import { DataStore, getDataStore, type ResearchSessionRecord, type ResearchTurnRecord } from '$lib/server/data/store/data-store';

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_SAVED_SESSIONS = 100;
const MAX_SAVED_TURNS = 50;
export const RESEARCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Keeps durable display history independent of bounded grounding and raw diagnostic payloads. */
export function createResearchRepository(options: { store?: DataStore | (() => DataStore); nowMs?: () => number; retentionDays?: number; maxSessions?: number; maxTurns?: number; ownerId?: string | (() => string) } = {}) {
	const store = () => typeof options.store === 'function' ? options.store() : options.store ?? getDataStore();
	const nowMs = options.nowMs ?? Date.now;
	const ownerId = () => typeof options.ownerId === 'function' ? options.ownerId() : options.ownerId ?? currentOwnerId();
	const configuredDays = Number(process.env.HOOP_HUB_RESEARCH_RETENTION_DAYS);
	const retentionDays = options.retentionDays ?? (Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : RESEARCH_RETENTION_DAYS);
	const maxSessions = options.maxSessions ?? MAX_SAVED_SESSIONS;
	const maxTurns = options.maxTurns ?? MAX_SAVED_TURNS;
	const lastPrunedByOwner = new Map<string, number>();
	function prune(force = false) {
		if (!force && nowMs() - (lastPrunedByOwner.get(ownerId()) ?? -Infinity) < 60_000) return;
		store().pruneResearchStorage(new Date(nowMs() - retentionDays * 86_400_000).toISOString(), maxSessions, maxTurns, 16_777_216, ownerId());
		lastPrunedByOwner.set(ownerId(), nowMs());
	}
	function readSession(sessionId: string) { prune(); const record = store().getResearchSession(sessionId); return record && (record.ownerId ?? 'local') === ownerId() ? record : null; }
	return {
		readSession,
		writeContext(sessionId: string, contextJson: string | null): void {
			const existing = readSession(sessionId);
			const timestamp = new Date(nowMs()).toISOString();
			store().putResearchSession({ ownerId: ownerId(), sessionId, title: existing?.title ?? 'Untitled research', contextJson, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp });
			prune(true);
		},
		saveResult(sessionId: string, input: { question: string; response: QueryAnswerResponse }): { turnId: string; createdAt: string } | null {
			const turnId = crypto.randomUUID();
			const timestamp = new Date(nowMs()).toISOString();
			const { toolResults: _rawTools, ...display } = input.response;
			const response = { ...display, sessionId, researchTurnId: turnId } satisfies SavedResearchResponse;
			const responseJson = JSON.stringify(response);
			if (Buffer.byteLength(responseJson) > MAX_RESPONSE_BYTES || input.question.length > 4_000) return null;
			const existing = readSession(sessionId);
			store().putResearchSession({ ownerId: ownerId(), sessionId, title: existing && existing.title !== 'Untitled research' ? existing.title : input.question.slice(0, 100), contextJson: existing?.contextJson ?? null, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp });
			store().putResearchTurn({ turnId, sessionId, question: input.question, responseJson, createdAt: timestamp });
			prune(true);
			return { turnId, createdAt: timestamp };
		},
		list(limit = 20, cursor?: string): SavedResearchList {
			prune();
			const before = cursor ? parseResearchCursor(cursor) : undefined;
			const records = store().listResearchSessions(limit + 1, before, ownerId());
			const selected = records.slice(0, limit);
			const last = selected.at(-1);
			return { sessions: selected.map(mapSummary), ...(records.length > limit && last ? { nextCursor: Buffer.from(JSON.stringify({ updatedAt: last.updatedAt, sessionId: last.sessionId })).toString('base64url') } : {}) };
		},
		get(sessionId: string): SavedResearchDetail | null {
			const session = readSession(sessionId);
			if (!session) return null;
			const turns = store().listResearchTurns(sessionId).map(mapTurn);
			return { session: mapSummary({ ...session, turnCount: turns.length }), turns };
		},
		getTurn(sessionId: string, turnId: string): SavedResearchTurn | null {
			if (!readSession(sessionId)) return null;
			const record = store().getResearchTurn(sessionId, turnId);
			return record ? mapTurn(record) : null;
		},
		rename(sessionId: string, title: string): boolean {
			const record = readSession(sessionId);
			if (!record) return false;
			store().putResearchSession({ ...record, title: title.trim(), updatedAt: new Date(nowMs()).toISOString() });
			return true;
		},
		delete(sessionId: string): void { if (readSession(sessionId)) store().deleteResearchSession(sessionId); }
	};
}

export type ResearchRepository = ReturnType<typeof createResearchRepository>;
export const researchRepository = createResearchRepository();

/* Serialization helpers */

function mapSummary(record: ResearchSessionRecord & { turnCount: number }): SavedResearchSummary {
	return { sessionId: record.sessionId, title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt, turnCount: record.turnCount };
}

function mapTurn(record: ResearchTurnRecord): SavedResearchTurn {
	return { turnId: record.turnId, question: record.question, createdAt: record.createdAt, response: JSON.parse(record.responseJson) as SavedResearchResponse };
}

function parseResearchCursor(cursor: string): { updatedAt: string; sessionId: string } {
	try {
		if (cursor.length > 256) throw new Error();
		const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
		if (!parsed || typeof parsed.updatedAt !== 'string' || !Number.isFinite(Date.parse(parsed.updatedAt)) || typeof parsed.sessionId !== 'string' || !RESEARCH_ID_PATTERN.test(parsed.sessionId)) throw new Error();
		return parsed;
	} catch { throw new Error('Invalid research cursor.'); }
}

/* End serialization helpers */
