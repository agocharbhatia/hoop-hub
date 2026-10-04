import { currentOwnerId } from './context';
import { BetaError } from './config';
import { getBetaStore, type BetaStore } from './store';
import { researchRepository, type ResearchRepository } from '$lib/server/research/repository';

export const FEEDBACK_KINDS = ['incorrect_answer', 'missing_data', 'video_problem', 'slow_response', 'other'] as const;

/** Bind reports to an owned saved answer; never accept a client-supplied trace or diagnostic dump. */
export function saveFeedback(value: unknown, store: BetaStore = getBetaStore(), repository: ResearchRepository = researchRepository) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BetaError('Provide feedback for a saved answer.');
	const input = value as Record<string, unknown>;
	if (Object.keys(input).some((key) => !['sessionId', 'turnId', 'kind', 'comment'].includes(key)) || typeof input.sessionId !== 'string' || typeof input.turnId !== 'string' || !FEEDBACK_KINDS.includes(input.kind as typeof FEEDBACK_KINDS[number]) || typeof input.comment !== 'string' || !input.comment.trim() || input.comment.length > 2000) throw new BetaError('Choose an issue and describe it in 1 to 2000 characters.');
	const turn = repository.getTurn(input.sessionId, input.turnId);
	if (!turn) throw new BetaError('Saved research was not found.', 404);
	const comment = input.comment.trim();
	const ownerId = currentOwnerId();
	const now = Date.now();
	return store.db.transaction(() => {
		store.consumeCounter(`feedback:${ownerId}:${new Date(now).toISOString().slice(0, 10)}`, 30, (Math.floor(now / 86_400_000) + 1) * 86_400_000, now);
		const existing = store.db.query<{ id: string }>('SELECT id FROM beta_feedback WHERE owner_id=@ownerId AND turn_id=@turnId').get({ ownerId, turnId: input.turnId });
		const id = existing?.id ?? crypto.randomUUID();
		store.db.query(`INSERT INTO beta_feedback(id,owner_id,session_id,turn_id,trace_id,kind,comment,created_at)
			VALUES (@id,@ownerId,@sessionId,@turnId,@traceId,@kind,@comment,@now)
			ON CONFLICT(owner_id,turn_id) DO UPDATE SET kind=excluded.kind,comment=excluded.comment,created_at=excluded.created_at`)
			.run({ id, ownerId, sessionId: input.sessionId, turnId: input.turnId, traceId: turn.response.traceId, kind: input.kind, comment, now });
		return { id };
	}).immediate();
}
