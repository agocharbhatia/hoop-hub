import { normalizeMetricQuery } from '$lib/server/metrics/resolve-metrics';
import { getDataStore, type PlayerDirectoryEntryRecord, type ReplacePlayerDirectoryEntryInput } from '$lib/server/data/store';
import playerDirectorySnapshot from './fixtures/player-directory-snapshot.json';

type PlayerDirectorySnapshotRow = {
	firstName?: string;
	lastName?: string;
	playerId?: number;
	teamId?: number;
};

const PLAYER_DIRECTORY_SNAPSHOT_VERSION = 'bttmly-nba-master-players-json';
const PLAYER_DIRECTORY_IMPORTED_AT = '2026-03-25T00:00:00.000Z';

/**
 * Keeps structured subject resolution pinned to a deterministic local snapshot instead of request-time network state.
 */
function loadPlayerDirectorySnapshot(): ReplacePlayerDirectoryEntryInput[] {
	const parsed = playerDirectorySnapshot as PlayerDirectorySnapshotRow[];

	return parsed.flatMap((entry) => {
		const playerId = typeof entry.playerId === 'number' ? String(entry.playerId) : '';
		const firstName = typeof entry.firstName === 'string' ? entry.firstName.trim() : '';
		const lastName = typeof entry.lastName === 'string' ? entry.lastName.trim() : '';
		const canonicalName = `${firstName} ${lastName}`.trim();

		if (!playerId || !canonicalName) {
			return [];
		}

		return [
			{
				playerId,
				canonicalName,
				normalizedName: normalizeMetricQuery(canonicalName),
				teamId: typeof entry.teamId === 'number' ? String(entry.teamId) : null
			}
		];
	});
}

const PLAYER_DIRECTORY_SNAPSHOT = loadPlayerDirectorySnapshot();
const PLAYER_DIRECTORY_NAMES_BY_LENGTH = Array.from(
	new Set(PLAYER_DIRECTORY_SNAPSHOT.map((entry) => entry.canonicalName))
).sort((left, right) => right.length - left.length);

/* Helper functions */

function ensurePlayerDirectorySeeded(): void {
	const store = getDataStore();
	if (store.countPlayerDirectoryEntries() > 0) {
		return;
	}

	store.replacePlayerDirectorySnapshot(
		PLAYER_DIRECTORY_SNAPSHOT_VERSION,
		PLAYER_DIRECTORY_IMPORTED_AT,
		PLAYER_DIRECTORY_SNAPSHOT
	);
}

function hasNormalizedNameMatch(normalizedQuestion: string, normalizedName: string): boolean {
	const paddedQuestion = ` ${normalizedQuestion} `;
	return paddedQuestion.includes(` ${normalizedName} `);
}

/* Public lookup API */

export function findPlayerDirectoryEntryById(playerId: string): PlayerDirectoryEntryRecord | null {
	ensurePlayerDirectorySeeded();
	return getDataStore().getPlayerDirectoryEntryById(playerId);
}

export function findPlayerDirectoryEntriesByExactName(name: string): PlayerDirectoryEntryRecord[] {
	ensurePlayerDirectorySeeded();
	return getDataStore().getPlayerDirectoryEntriesByNormalizedName(normalizeMetricQuery(name));
}

export function extractPlayerDirectoryExactNameMentions(question: string): string[] {
	ensurePlayerDirectorySeeded();

	const normalizedQuestion = normalizeMetricQuery(question);
	return PLAYER_DIRECTORY_NAMES_BY_LENGTH.map((canonicalName) => ({
		canonicalName,
		normalizedName: normalizeMetricQuery(canonicalName)
	}))
		.flatMap(({ canonicalName, normalizedName }) => {
			if (!hasNormalizedNameMatch(normalizedQuestion, normalizedName)) {
				return [];
			}

			return [
				{
					canonicalName,
					index: normalizedQuestion.indexOf(normalizedName),
					length: normalizedName.length
				}
			];
		})
		.sort((left, right) => left.index - right.index || right.length - left.length)
		.map((match) => match.canonicalName);
}

export function validateStructuredPlayerSubjectPairs(subject: { ids?: string[]; names?: string[] }): string | null {
	const ids = subject.ids ?? [];
	const names = subject.names ?? [];

	if (ids.length === 0 || names.length === 0) {
		return null;
	}

	if (ids.length !== names.length) {
		return 'query.subject.ids and query.subject.names must have matching lengths when both are provided.';
	}

	for (let index = 0; index < ids.length; index += 1) {
		const player = findPlayerDirectoryEntryById(ids[index]);
		if (!player) {
			return `query.subject.ids[${index}] and query.subject.names[${index}] must refer to the same canonical player.`;
		}

		if (player.normalizedName !== normalizeMetricQuery(names[index])) {
			return `query.subject.ids[${index}] and query.subject.names[${index}] must refer to the same canonical player.`;
		}
	}

	return null;
}
