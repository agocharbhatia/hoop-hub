import { nbaFetch, buildStatsUrl } from "./nba";
import { toIsoDate } from "./utils";

export type GameRow = {
  game_id: string;
  season: string;
  season_type: string;
  game_date: string;
  home_team_id: string;
  away_team_id: string;
  matchup: string;
};

export async function fetchSeasonGames(season: string, seasonType: string): Promise<GameRow[]> {
  const url = buildStatsUrl("leaguegamefinder", {
    LeagueID: "00",
    Season: season,
    SeasonType: seasonType,
    PlayerOrTeam: "T",
  });
  const response = await nbaFetch(url);
  const payload = await response.json();
  const resultSet = payload?.resultSets?.[0] ?? payload?.resultSet;
  if (!resultSet?.headers || !resultSet?.rowSet) return [];

  const rows: GameRow[] = [];
  for (const rawRow of resultSet.rowSet) {
    const row: Record<string, any> = {};
    resultSet.headers.forEach((header: string, idx: number) => (row[header] = rawRow[idx]));
    const gameId = String(row.GAME_ID ?? "");
    if (!gameId) continue;
    const gameDate = toIsoDate(String(row.GAME_DATE ?? ""));
    rows.push({
      game_id: gameId,
      season,
      season_type: seasonType,
      game_date: gameDate,
      home_team_id: String(row.HOME_TEAM_ID ?? row.TEAM_ID_HOME ?? ""),
      away_team_id: String(row.VISITOR_TEAM_ID ?? row.TEAM_ID_AWAY ?? ""),
      matchup: String(row.MATCHUP ?? ""),
    });
  }

  // leaguegamefinder returns two rows per game (one per team). De-dupe by game_id.
  const unique = new Map<string, GameRow>();
  for (const row of rows) {
    if (!unique.has(row.game_id)) unique.set(row.game_id, row);
  }

  return Array.from(unique.values());
}
