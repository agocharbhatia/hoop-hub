import identityIndex from './entity-media-index.json';

export type EntityMedia = Readonly<{
	kind: 'player' | 'team';
	id: string;
	name: string;
	initials: string;
	imageUrl: string;
}>;

export type EntityReference = string | { id?: string | number | null; name?: string | null };

type EntityIndex = {
	byId: Map<string, EntityMedia>;
	byName: Map<string, EntityMedia[]>;
};

// --- Identity index helpers ---

function normalizeEntityName(name: string): string {
	return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
		.replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function nameInitials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	return words.length > 1 ? `${words[0][0]}${words.at(-1)![0]}`.toUpperCase() : name.slice(0, 2).toUpperCase();
}

function addName(index: EntityIndex, name: string, entity: EntityMedia): void {
	const key = normalizeEntityName(name);
	const matches = index.byName.get(key) ?? [];
	if (!matches.some((candidate) => candidate.id === entity.id)) {
		index.byName.set(key, [...matches, entity]);
	}
}

function buildIndex(kind: EntityMedia['kind'], rows: string[][]): EntityIndex {
	const index: EntityIndex = { byId: new Map(), byName: new Map() };
	for (const [id, name, abbreviation, ...aliases] of rows) {
		if (!/^\d+$/.test(id) || !name) continue;
		const entity: EntityMedia = Object.freeze({
			kind, id, name, initials: kind === 'team' ? abbreviation : nameInitials(name),
			// NBA.com player profiles use these CDN identities. Images are decorative, not a roster assertion.
			imageUrl: kind === 'player'
				? `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`
				: `https://cdn.nba.com/logos/nba/${id}/primary/L/logo.svg`
		});
		index.byId.set(id, entity);
		for (const value of [name, abbreviation, ...aliases]) {
			if (value) addName(index, value, entity);
		}
	}
	return index;
}

/** Avoids placing the wrong face on an ambiguous name or a contradictory saved ID/name pair. */
function resolveEntity(index: EntityIndex, reference: EntityReference): EntityMedia | null {
	const { id, name } = typeof reference === 'string'
		? /^\d+$/.test(reference.trim()) ? { id: reference.trim() } : { name: reference }
		: reference;
	const hasId = id !== undefined && id !== null;
	const normalizedName = typeof name === 'string' ? normalizeEntityName(name) : '';
	const matches = normalizedName ? index.byName.get(normalizedName) ?? [] : [];
	if (hasId) {
		const candidate = index.byId.get(String(id));
		if (!candidate || (normalizedName && !matches.some((match) => match.id === candidate.id))) return null;
		return candidate;
	}
	return matches.length === 1 ? matches[0] : null;
}

// --- End identity index helpers ---

const players = buildIndex('player', identityIndex.players);
const teams = buildIndex('team', identityIndex.teams);

/** Uses local, exact identity grounding so decorative media needs no request-time lookup. */
export function resolvePlayerEntity(reference: EntityReference): EntityMedia | null {
	return resolveEntity(players, reference);
}

/** Never infers a player's team from a current roster when presenting historical research. */
export function resolveTeamEntity(reference: EntityReference): EntityMedia | null {
	return resolveEntity(teams, reference);
}
