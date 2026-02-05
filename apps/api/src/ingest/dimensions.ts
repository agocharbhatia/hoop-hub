import { nbaFetch, buildStatsUrl } from "./nba";
import { seasonLabelFromYear } from "./utils";

export type PlayerRow = {
  player_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  from_year?: string;
  to_year?: string;
};

export type TeamRow = {
  team_id: string;
  abbreviation: string;
  full_name: string;
  city: string;
  nickname: string;
};

function splitName(fullName: string) {
  const parts = fullName.split(" ");
  if (parts.length === 1) return { first: fullName, last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

export async function fetchPlayers(currentSeasonYear: number): Promise<PlayerRow[]> {
  const season = seasonLabelFromYear(currentSeasonYear);
  const url = buildStatsUrl("commonallplayers", {
    LeagueID: "00",
    Season: season,
    IsOnlyCurrentSeason: "0",
  });
  const response = await nbaFetch(url);
  const payload = await response.json();
  const resultSet = payload?.resultSets?.[0] ?? payload?.resultSet;
  if (!resultSet?.headers || !resultSet?.rowSet) return [];

  const rows: PlayerRow[] = [];
  for (const rawRow of resultSet.rowSet) {
    const row: Record<string, any> = {};
    resultSet.headers.forEach((header: string, idx: number) => (row[header] = rawRow[idx]));
    const fullName = String(row.DISPLAY_FIRST_LAST ?? row.PLAYER_NAME ?? "");
    const { first, last } = splitName(fullName);
    rows.push({
      player_id: String(row.PERSON_ID ?? row.PLAYER_ID ?? ""),
      full_name: fullName,
      first_name: first,
      last_name: last,
      is_active: String(row.ROSTERSTATUS ?? "").toUpperCase() === "1" || String(row.ROSTERSTATUS ?? "").toUpperCase() === "Y",
      from_year: row.FROM_YEAR ? String(row.FROM_YEAR) : undefined,
      to_year: row.TO_YEAR ? String(row.TO_YEAR) : undefined,
    });
  }
  return rows.filter((row) => row.player_id && row.full_name);
}

export async function fetchTeams(currentSeasonYear: number): Promise<TeamRow[]> {
  const season = seasonLabelFromYear(currentSeasonYear);
  const url = buildStatsUrl("leaguedashteamstats", {
    LeagueID: "00",
    Season: season,
    SeasonType: "Regular Season",
    PerMode: "PerGame",
  });
  const response = await nbaFetch(url);
  const payload = await response.json();
  const resultSet = payload?.resultSets?.[0] ?? payload?.resultSet;
  if (!resultSet?.headers || !resultSet?.rowSet) return [];

  const rows: TeamRow[] = [];
  for (const rawRow of resultSet.rowSet) {
    const row: Record<string, any> = {};
    resultSet.headers.forEach((header: string, idx: number) => (row[header] = rawRow[idx]));
    rows.push({
      team_id: String(row.TEAM_ID ?? ""),
      abbreviation: String(row.TEAM_ABBREVIATION ?? ""),
      full_name: String(row.TEAM_NAME ?? ""),
      city: String(row.TEAM_CITY ?? ""),
      nickname: String(row.TEAM_NAME ?? ""),
    });
  }
  return rows.filter((row) => row.team_id && row.full_name);
}
