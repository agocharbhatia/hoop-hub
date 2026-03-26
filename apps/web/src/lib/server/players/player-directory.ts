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
let playerDirectoryRefreshLoader: (() => ReplacePlayerDirectoryEntryInput[]) | null = null;

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

/* Helper functions */

type PlayerDirectoryAvailabilityResult =
	| { ok: true; source: 'stored' | 'refreshed' }
	| { ok: false; message: string };

function loadRefreshedPlayerDirectorySnapshot(): ReplacePlayerDirectoryEntryInput[] {
	return (playerDirectoryRefreshLoader ?? loadPlayerDirectorySnapshot)();
}

function replacePlayerDirectorySnapshot(entries: ReplacePlayerDirectoryEntryInput[]): void {
	getDataStore().replacePlayerDirectorySnapshot(PLAYER_DIRECTORY_SNAPSHOT_VERSION, PLAYER_DIRECTORY_IMPORTED_AT, entries);
}

/* Public availability API */

export function refreshPlayerDirectorySnapshot(): PlayerDirectoryAvailabilityResult {
	const store = getDataStore();

	try {
		replacePlayerDirectorySnapshot(loadRefreshedPlayerDirectorySnapshot());
		return { ok: true, source: 'refreshed' };
	} catch (error) {
		if (store.countPlayerDirectoryEntries() > 0) {
			return { ok: true, source: 'stored' };
		}

		return {
			ok: false,
			message: error instanceof Error ? error.message : 'Player directory refresh failed.'
		};
	}
}

export function ensurePlayerDirectoryAvailable(options: { allowRefresh?: boolean } = {}): PlayerDirectoryAvailabilityResult {
	if (getDataStore().countPlayerDirectoryEntries() > 0) {
		return { ok: true, source: 'stored' };
	}

	if (options.allowRefresh === false) {
		return {
			ok: false,
			message: 'Player directory refresh is disabled by request policy and no stored snapshot is available.'
		};
	}

	return refreshPlayerDirectorySnapshot();
}

export function hasStoredPlayerDirectorySnapshot(): boolean {
	return getDataStore().countPlayerDirectoryEntries() > 0;
}

/* Public lookup API */

export function findPlayerDirectoryEntryById(playerId: string): PlayerDirectoryEntryRecord | null {
	return getDataStore().getPlayerDirectoryEntryById(playerId);
}

export function findPlayerDirectoryEntriesByExactName(name: string): PlayerDirectoryEntryRecord[] {
	return getDataStore().getPlayerDirectoryEntriesByNormalizedName(normalizeMetricQuery(name));
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

export function setPlayerDirectoryRefreshLoaderForTests(loader: (() => ReplacePlayerDirectoryEntryInput[]) | null): void {
	playerDirectoryRefreshLoader = loader;
}
