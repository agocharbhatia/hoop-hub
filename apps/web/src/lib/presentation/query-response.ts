import type { QueryAnswerResponse, QueryAnswerArtifact } from '$lib/contracts/answer-response';
import type { ErrorResponse } from '$lib/contracts/chat';

function isVisibleTableArtifact(
	artifact: QueryAnswerArtifact
): artifact is Extract<QueryAnswerArtifact, { type: 'table' }> {
	if (artifact.type !== 'table') {
		return false;
	}

	// Suppress trivial one-row lookup tables in the main chat UI when the answer
	// can already be expressed cleanly in prose.
	if (artifact.shape === 'table' && artifact.rows.length <= 1) {
		return false;
	}

	return true;
}

export function getAssistantMessageContent(
	responseOk: boolean,
	payload: QueryAnswerResponse | ErrorResponse
): string {
	if (!responseOk) {
		return 'error' in payload ? payload.error : 'Unable to process this query.';
	}

	if ('error' in payload) {
		return payload.error;
	}

	const answer = payload.answer.trim();
	if (answer) {
		return answer;
	}

	const primaryTable = getPrimaryTableArtifact(payload);
	if (primaryTable) {
		const rowCount = primaryTable.rows.length;
		return rowCount > 0
			? `Returned ${rowCount} result${rowCount === 1 ? '' : 's'}.`
			: 'No rows returned for this query.';
	}

	return payload.warnings[0]?.message ?? 'Unable to process this query.';
}

export function getPrimaryTableArtifact(
	payload: QueryAnswerResponse
): Extract<QueryAnswerArtifact, { type: 'table' }> | null {
	return payload.artifacts.find(isVisibleTableArtifact) ?? null;
}

export function getSupportingTableArtifacts(
	payload: QueryAnswerResponse
): Array<Extract<QueryAnswerArtifact, { type: 'table' }>> {
	const visibleTables = payload.artifacts.filter(isVisibleTableArtifact);
	const primaryTable = visibleTables[0] ?? null;

	return visibleTables.filter((artifact) => artifact !== primaryTable);
}

export function getTextBlockArtifacts(
	payload: QueryAnswerResponse
): Array<Extract<QueryAnswerArtifact, { type: 'text_block' }>> {
	return payload.artifacts.filter(
		(artifact): artifact is Extract<QueryAnswerArtifact, { type: 'text_block' }> =>
			artifact.type === 'text_block'
	);
}

export function getVisibleWarningMessages(payload: QueryAnswerResponse): string[] {
	return payload.warnings
		.map((warning) => warning.message.trim())
		.filter((message) => message.length > 0);
}
