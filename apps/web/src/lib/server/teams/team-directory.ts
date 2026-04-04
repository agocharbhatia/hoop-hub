import { normalizeMetricQuery } from '$lib/server/metrics/resolve-metrics';
import teamDirectorySnapshot from './fixtures/team-directory-snapshot.json';

type TeamDirectorySnapshotRow = {
	teamId: string;
	canonicalName: string;
	cityName: string;
	shortName: string;
	abbreviation: string;
};

type CuratedTeamAliasDefinition = {
	alias: string;
	teamIds: string[];
};

export type TeamDirectoryEntryRecord = {
	teamId: string;
	canonicalName: string;
	normalizedName: string;
	cityName: string;
	shortName: string;
	abbreviation: string;
};

const CURATED_TEAM_ALIASES: CuratedTeamAliasDefinition[] = [
	{ alias: 'Wolves', teamIds: ['1610612750'] },
	{ alias: 'Sixers', teamIds: ['1610612755'] },
	{ alias: 'Blazers', teamIds: ['1610612757'] },
	{ alias: 'Cavs', teamIds: ['1610612739'] },
	{ alias: 'LA', teamIds: ['1610612746', '1610612747'] }
] as const;

const TEAM_DIRECTORY_SNAPSHOT = (teamDirectorySnapshot as TeamDirectorySnapshotRow[]).map<TeamDirectoryEntryRecord>((entry) => ({
	teamId: entry.teamId,
	canonicalName: entry.canonicalName,
	normalizedName: normalizeMetricQuery(entry.canonicalName),
	cityName: entry.cityName,
	shortName: entry.shortName,
	abbreviation: entry.abbreviation
}));

const TEAM_DIRECTORY_BY_ID = new Map(TEAM_DIRECTORY_SNAPSHOT.map((entry) => [entry.teamId, entry]));
const TEAM_DIRECTORY_BY_KEY = buildTeamDirectoryLookup();

/* Helper functions */

function addLookupValue(
	lookup: Map<string, TeamDirectoryEntryRecord[]>,
	key: string,
	entry: TeamDirectoryEntryRecord
): void {
	const normalizedKey = normalizeMetricQuery(key);
	const existing = lookup.get(normalizedKey) ?? [];

	if (!existing.some((candidate) => candidate.teamId === entry.teamId)) {
		existing.push(entry);
		existing.sort((left, right) => left.canonicalName.localeCompare(right.canonicalName));
		lookup.set(normalizedKey, existing);
	}
}

function buildTeamDirectoryLookup(): Map<string, TeamDirectoryEntryRecord[]> {
	const lookup = new Map<string, TeamDirectoryEntryRecord[]>();

	for (const entry of TEAM_DIRECTORY_SNAPSHOT) {
		addLookupValue(lookup, entry.canonicalName, entry);
		addLookupValue(lookup, entry.cityName, entry);
		addLookupValue(lookup, entry.shortName, entry);
		addLookupValue(lookup, entry.abbreviation, entry);
	}

	for (const alias of CURATED_TEAM_ALIASES) {
		const matches = alias.teamIds
			.map((teamId) => TEAM_DIRECTORY_BY_ID.get(teamId))
			.filter((entry): entry is TeamDirectoryEntryRecord => entry !== undefined);

		if (matches.length > 0) {
			lookup.set(normalizeMetricQuery(alias.alias), matches);
		}
	}

	return lookup;
}

/* Public lookup API */

export function findTeamDirectoryEntryById(teamId: string): TeamDirectoryEntryRecord | null {
	return TEAM_DIRECTORY_BY_ID.get(teamId) ?? null;
}

export function findTeamDirectoryEntriesByNameOrAlias(name: string): TeamDirectoryEntryRecord[] {
	return TEAM_DIRECTORY_BY_KEY.get(normalizeMetricQuery(name)) ?? [];
}

export function validateStructuredTeamSubjectPairs(subject: { ids?: string[]; names?: string[] }): string | null {
	const ids = subject.ids ?? [];
	const names = subject.names ?? [];

	if (ids.length === 0 || names.length === 0) {
		return null;
	}

	if (ids.length !== names.length) {
		return 'query.subject.ids and query.subject.names must have matching lengths when both are provided.';
	}

	for (let index = 0; index < ids.length; index += 1) {
		const team = findTeamDirectoryEntryById(ids[index]);
		if (!team) {
			return `query.subject.ids[${index}] and query.subject.names[${index}] must refer to the same canonical team.`;
		}

		const nameMatches = findTeamDirectoryEntriesByNameOrAlias(names[index]);
		if (nameMatches.length !== 1 || nameMatches[0]?.teamId !== team.teamId) {
			return `query.subject.ids[${index}] and query.subject.names[${index}] must refer to the same canonical team.`;
		}
	}

	return null;
}
