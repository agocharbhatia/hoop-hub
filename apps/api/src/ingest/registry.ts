export type StatsEndpoint = {
  endpoint: string;
  params: Record<string, string | number>;
  description?: string;
};

export const STAT_ENDPOINTS: StatsEndpoint[] = [
  {
    endpoint: "leaguedashplayerstats",
    params: {
      LeagueID: "00",
      PerMode: "PerGame",
      MeasureType: "Base",
      PlusMinus: "N",
      PaceAdjust: "N",
      Rank: "N",
      Outcome: "",
      Location: "",
      Month: "0",
      SeasonSegment: "",
      DateFrom: "",
      DateTo: "",
      OpponentTeamID: "0",
      VsConference: "",
      VsDivision: "",
      GameSegment: "",
      Period: "0",
      LastNGames: "0",
      TeamID: "0",
      PlayerPosition: "",
      StarterBench: "",
    },
    description: "Core player stats",
  },
  {
    endpoint: "leaguedashplayershotlocations",
    params: {
      LeagueID: "00",
      PerMode: "PerGame",
      MeasureType: "Base",
      PlusMinus: "N",
      PaceAdjust: "N",
      Rank: "N",
      Outcome: "",
      Location: "",
      Month: "0",
      SeasonSegment: "",
      DateFrom: "",
      DateTo: "",
      OpponentTeamID: "0",
      VsConference: "",
      VsDivision: "",
      GameSegment: "",
      Period: "0",
      LastNGames: "0",
      TeamID: "0",
      PlayerPosition: "",
      StarterBench: "",
    },
    description: "Shot location splits",
  },
];

export const SEASON_TYPES = ["Regular Season", "Playoffs", "Play-In"] as const;
