import type { ErrorResponse } from '$lib/contracts/chat';
import type { StatsQueryResponse } from '$lib/contracts/semantic-query';

export function getAssistantMessageContent(
	responseOk: boolean,
	payload: StatsQueryResponse | ErrorResponse
): string {
	if (!responseOk) {
		return 'error' in payload ? payload.error : 'Unable to process this query.';
	}

	if ('error' in payload) {
		return payload.error;
	}

	if (payload.status === 'ok') {
		const summary = payload.result?.summary?.trim();
		if (summary) {
			return summary;
		}

		const rowCount = payload.result?.rows.length ?? 0;
		return rowCount > 0
			? `Returned ${rowCount} result${rowCount === 1 ? '' : 's'}.`
			: 'No rows returned for this query.';
	}

	return payload.warnings[0]?.message ?? 'Unable to process this query.';
}
