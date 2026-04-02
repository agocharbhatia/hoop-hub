import { normalizeMetricQuery } from '$lib/server/metrics/resolve-metrics';
import { getDataStore, type PlayerDirectoryEntryRecord, type ReplacePlayerDirectoryEntryInput } from '$lib/server/data/store';
import playerDirectorySnapshot from './fixtures/player-directory-snapshot.json';

type PlayerDirectorySnapshotRow = {
	firstName?: string;
	lastName?: string;
	playerId?: number;
	teamId?: number;
};

type CuratedPlayerAliasDefinition = {
	alias: string;
	playerIds: string[];
};

type PlayerDirectoryMention = {
	value: string;
	normalizedValue: string;
	resolvedName: string;
};

type PlayerDirectoryMentionMatch = {
	resolvedName: string;
	index: number;
	length: number;
};

const PLAYER_DIRECTORY_SNAPSHOT_VERSION = 'bttmly-nba-master-players-json';
const PLAYER_DIRECTORY_IMPORTED_AT = '2026-03-25T00:00:00.000Z';
let playerDirectoryRefreshLoader: (() => ReplacePlayerDirectoryEntryInput[]) | null = null;

const CURATED_PLAYER_ALIASES: CuratedPlayerAliasDefinition[] = [
	{ alias: 'Steph', playerIds: ['201939'] },
	{ alias: 'Curry', playerIds: ['201939'] },
	{ alias: 'Dame', playerIds: ['203081'] },
	{ alias: 'Jokic', playerIds: ['203999'] },
	{ alias: 'Williams', playerIds: ['1629684', '1629026', '101150', '1630172'] }
];

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
const PLAYER_DIRECTORY_SNAPSHOT_BY_ID = new Map(PLAYER_DIRECTORY_SNAPSHOT.map((entry) => [entry.playerId, entry]));
const PLAYER_DIRECTORY_NAMES_BY_LENGTH = Array.from(
	new Set(PLAYER_DIRECTORY_SNAPSHOT.map((entry) => entry.canonicalName))
).sort((left, right) => right.length - left.length);
const CURATED_PLAYER_ALIAS_IDS = new Map(
	CURATED_PLAYER_ALIASES.map((entry) => [normalizeMetricQuery(entry.alias), entry.playerIds])
);
const PLAYER_DIRECTORY_MENTIONS_BY_LENGTH = buildPlayerDirectoryMentions();

/* Helper functions */

function getCanonicalPlayersByIds(playerIds: string[]): PlayerDirectoryEntryRecord[] {
	return playerIds
		.map((playerId) => getDataStore().getPlayerDirectoryEntryById(playerId))
		.filter((entry): entry is PlayerDirectoryEntryRecord => entry !== null);
}

function getSnapshotPlayersByIds(playerIds: string[]): ReplacePlayerDirectoryEntryInput[] {
	return playerIds
		.map((playerId) => PLAYER_DIRECTORY_SNAPSHOT_BY_ID.get(playerId))
		.filter((entry): entry is ReplacePlayerDirectoryEntryInput => entry !== undefined);
}

function buildPlayerDirectoryMentions(): PlayerDirectoryMention[] {
	const canonicalMentions = PLAYER_DIRECTORY_NAMES_BY_LENGTH.map((canonicalName) => ({
		value: canonicalName,
		normalizedValue: normalizeMetricQuery(canonicalName),
		resolvedName: canonicalName
	}));

	const aliasMentions = CURATED_PLAYER_ALIASES.flatMap((entry) => {
		const normalizedAlias = normalizeMetricQuery(entry.alias);
		const matches = getSnapshotPlayersByIds(entry.playerIds);
		if (matches.length === 0) {
			return [];
		}

		return [
			{
				value: entry.alias,
				normalizedValue: normalizedAlias,
				resolvedName: matches.length === 1 ? matches[0].canonicalName : entry.alias
			}
		];
	});

	return [...canonicalMentions, ...aliasMentions].sort(
		(left, right) => right.normalizedValue.length - left.normalizedValue.length
	);
}

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

export function ensurePlayerDirectoryAvailable(): PlayerDirectoryAvailabilityResult {
	if (getDataStore().countPlayerDirectoryEntries() > 0) {
		return { ok: true, source: 'stored' };
	}

	return refreshPlayerDirectorySnapshot();
}

export function hasStoredPlayerDirectorySnapshot(): boolean {
	return getDataStore().countPlayerDirectoryEntries() > 0;
}

function hasNormalizedNameMatch(normalizedQuestion: string, normalizedName: string): boolean {
	const paddedQuestion = ` ${normalizedQuestion} `;
	return paddedQuestion.includes(` ${normalizedName} `);
}

function filterOverlappingMentions(matches: PlayerDirectoryMentionMatch[]): PlayerDirectoryMentionMatch[] {
	const acceptedMatches: PlayerDirectoryMentionMatch[] = [];

	for (const match of matches) {
		const matchEnd = match.index + match.length;
		const overlapsExistingMatch = acceptedMatches.some((acceptedMatch) => {
			const acceptedEnd = acceptedMatch.index + acceptedMatch.length;
			return match.index < acceptedEnd && acceptedMatch.index < matchEnd;
		});

		if (overlapsExistingMatch) {
			continue;
		}

		acceptedMatches.push(match);
	}

	return acceptedMatches;
}

/* Public lookup API */

export function findPlayerDirectoryEntryById(playerId: string): PlayerDirectoryEntryRecord | null {
	return getDataStore().getPlayerDirectoryEntryById(playerId);
}

export function findPlayerDirectoryEntriesByExactName(name: string): PlayerDirectoryEntryRecord[] {
	return getDataStore().getPlayerDirectoryEntriesByNormalizedName(normalizeMetricQuery(name));
}

export function findPlayerDirectoryEntriesByNameOrAlias(name: string): PlayerDirectoryEntryRecord[] {
	const exactMatches = findPlayerDirectoryEntriesByExactName(name);
	if (exactMatches.length > 0) {
		return exactMatches;
	}

	const aliasMatches = CURATED_PLAYER_ALIAS_IDS.get(normalizeMetricQuery(name));
	if (!aliasMatches) {
		return [];
	}

	return getCanonicalPlayersByIds(aliasMatches);
}

export function extractPlayerDirectoryExactNameMentions(question: string): string[] {
	if (!ensurePlayerDirectoryAvailable().ok) {
		return [];
	}

	const normalizedQuestion = normalizeMetricQuery(question);
	return filterOverlappingMentions(
		PLAYER_DIRECTORY_MENTIONS_BY_LENGTH.flatMap(({ resolvedName, normalizedValue }) => {
			if (!hasNormalizedNameMatch(normalizedQuestion, normalizedValue)) {
				return [];
			}

			return [
				{
					resolvedName,
					index: normalizedQuestion.indexOf(normalizedValue),
					length: normalizedValue.length
				}
			];
		})
			.sort((left, right) => left.index - right.index || right.length - left.length)
	)
		.map((match) => match.resolvedName);
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

		const nameMatches = findPlayerDirectoryEntriesByNameOrAlias(names[index]);
		if (nameMatches.length !== 1 || nameMatches[0]?.playerId !== player.playerId) {
			return `query.subject.ids[${index}] and query.subject.names[${index}] must refer to the same canonical player.`;
		}
	}

	return null;
}

export function setPlayerDirectoryRefreshLoaderForTests(loader: (() => ReplacePlayerDirectoryEntryInput[]) | null): void {
	playerDirectoryRefreshLoader = loader;
}
