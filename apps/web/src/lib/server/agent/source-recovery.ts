import type { TraceSourceCall } from '$lib/contracts/chat';
import type { QueryAnswerResponse } from '$lib/contracts/answer-response';

/** Persist recovery intent so saved answers need no raw traces or guesses based on model prose. */
export function sourceRecovery(status: QueryAnswerResponse['status'], sources: TraceSourceCall[]): Pick<QueryAnswerResponse, 'recovery'> {
	return status === 'coverage_gap' && sources.some(source => !source.stale && source.sourceStatus !== 'ok' &&
		(source.retryable || source.sourceStatus === 'timeout' || source.sourceStatus === 'rate_limited'))
		? { recovery: { kind: 'temporary_source_failure' } } : {};
}
