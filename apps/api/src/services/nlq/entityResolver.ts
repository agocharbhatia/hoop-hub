const players = [
  { id: "player_scottie_barnes", name: "scottie barnes" },
  { id: "player_pascal_siakam", name: "pascal siakam" },
  { id: "player_stephen_curry", name: "stephen curry" },
  { id: "player_jimmy_butler", name: "jimmy butler" },
];

const teams = [
  { id: "team_tor", name: "toronto" },
  { id: "team_gsw", name: "golden state" },
  { id: "team_mia", name: "miami" },
];

export type ResolvedEntities = {
  players: typeof players;
  teams: typeof teams;
  season?: string;
  seasonType?: "regular" | "playoffs" | "playin";
  shotZones: string[];
  shotTypes: string[];
  playCategories: string[];
  coverageTypes: string[];
  clutch?: boolean;
};

function matchList<T extends { name: string }>(query: string, list: T[]): T[] {
  return list.filter((item) => query.includes(item.name));
}

export function resolveEntitiesFromNames(input: {
  players?: string[];
  teams?: string[];
}): Pick<ResolvedEntities, "players" | "teams"> {
  const playerNames = (input.players ?? []).map((p) => p.toLowerCase());
  const teamNames = (input.teams ?? []).map((t) => t.toLowerCase());
  return {
    players: players.filter((p) => playerNames.some((name) => name.includes(p.name) || p.name.includes(name))),
    teams: teams.filter((t) => teamNames.some((name) => name.includes(t.name) || t.name.includes(name))),
  };
}

export function extractEntities(query: string): ResolvedEntities {
  const normalized = query.toLowerCase();
  const playersMatched = matchList(normalized, players);
  const teamsMatched = matchList(normalized, teams);

  const shotZones: string[] = [];
  if (normalized.includes("mid-range") || normalized.includes("midrange")) {
    shotZones.push("mid-range");
  }
  if (normalized.includes("rim") || normalized.includes("at the rim")) {
    shotZones.push("rim");
  }
  if (normalized.includes("three") || normalized.includes("3pt")) {
    shotZones.push("three");
  }

  const shotTypes: string[] = [];
  if (normalized.includes("pull-up")) shotTypes.push("pull-up");
  if (normalized.includes("catch-and-shoot") || normalized.includes("catch and shoot")) {
    shotTypes.push("catch-and-shoot");
  }

  const playCategories: string[] = [];
  if (normalized.includes("isolation") || normalized.includes("iso")) {
    playCategories.push("isolation");
  }

  const coverageTypes: string[] = [];
  if (normalized.includes("drop coverage")) coverageTypes.push("drop");
  if (normalized.includes("switch")) coverageTypes.push("switch");

  let seasonType: ResolvedEntities["seasonType"] | undefined;
  if (normalized.includes("playoff")) seasonType = "playoffs";
  if (normalized.includes("play-in")) seasonType = "playin";

  const seasonMatch = normalized.match(/20\d{2}/g);
  const season = seasonMatch ? seasonMatch[0] : undefined;

  const clutch = normalized.includes("clutch") ? true : undefined;

  return {
    players: playersMatched,
    teams: teamsMatched,
    season,
    seasonType,
    shotZones,
    shotTypes,
    playCategories,
    coverageTypes,
    clutch,
  };
}
