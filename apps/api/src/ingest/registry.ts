export type IngestMode = "season" | "game" | "entity_fanout";
export type RetryProfile = "default" | "fragile_json" | "non_retryable";

export type EndpointVariant = {
  id: string;
  params: Record<string, string | number>;
};

export type EndpointManifest = {
  module: string;
  endpoint: string;
  enabled: boolean;
  phase: "phase1" | "phase2";
  mode: IngestMode;
  priority: number;
  retryProfile: RetryProfile;
  notes?: string;
  variants: EndpointVariant[];
};

const perGameVariant: EndpointVariant = {
  id: "per_game",
  params: {
    LeagueID: "00",
    PerMode: "PerGame",
  },
};

const basePerGameVariant: EndpointVariant = {
  id: "base_per_game",
  params: {
    LeagueID: "00",
    PerMode: "PerGame",
    MeasureType: "Base",
  },
};

const playerTeamMeasureVariants: EndpointVariant[] = [
  "Base",
  "Advanced",
  "Misc",
  "Four Factors",
  "Scoring",
  "Opponent",
  "Usage",
  "Defense",
].map((measureType) => ({
  id: `measure_${measureType.toLowerCase().replace(/\s+/g, "_")}_per_game`,
  params: {
    LeagueID: "00",
    PerMode: "PerGame",
    MeasureType: measureType,
  },
}));

const seasonEndpoints: EndpointManifest[] = [
  {
    module: "leaguedashplayerstats",
    endpoint: "leaguedashplayerstats",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 10,
    retryProfile: "default",
    notes: "Core player box + advanced categories",
    variants: playerTeamMeasureVariants,
  },
  {
    module: "leaguedashteamstats",
    endpoint: "leaguedashteamstats",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 11,
    retryProfile: "default",
    notes: "Core team box + advanced categories",
    variants: playerTeamMeasureVariants,
  },
  {
    module: "leagueleaders",
    endpoint: "leagueleaders",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 12,
    retryProfile: "default",
    variants: [perGameVariant],
  },
  {
    module: "leaguedashplayerclutch",
    endpoint: "leaguedashplayerclutch",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 20,
    retryProfile: "default",
    variants: [basePerGameVariant],
  },
  {
    module: "leaguedashteamclutch",
    endpoint: "leaguedashteamclutch",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 21,
    retryProfile: "default",
    variants: [basePerGameVariant],
  },
  {
    module: "leaguedashplayerptshot",
    endpoint: "leaguedashplayerptshot",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 22,
    retryProfile: "default",
    variants: [perGameVariant],
  },
  {
    module: "leaguedashteamptshot",
    endpoint: "leaguedashteamptshot",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 23,
    retryProfile: "default",
    variants: [perGameVariant],
  },
  {
    module: "leaguedashoppptshot",
    endpoint: "leaguedashoppptshot",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 24,
    retryProfile: "default",
    variants: [perGameVariant],
  },
  {
    module: "leaguedashplayershotlocations",
    endpoint: "leaguedashplayershotlocations",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 25,
    retryProfile: "fragile_json",
    variants: [basePerGameVariant],
  },
  {
    module: "leaguedashteamshotlocations",
    endpoint: "leaguedashteamshotlocations",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 26,
    retryProfile: "fragile_json",
    variants: [basePerGameVariant],
  },
  {
    module: "leaguedashptstats",
    endpoint: "leaguedashptstats",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 27,
    retryProfile: "default",
    variants: [perGameVariant],
  },
  {
    module: "leaguedashptdefend",
    endpoint: "leaguedashptdefend",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 28,
    retryProfile: "default",
    variants: [perGameVariant],
  },
  {
    module: "leaguedashptteamdefend",
    endpoint: "leaguedashptteamdefend",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 29,
    retryProfile: "default",
    variants: [perGameVariant],
  },
  {
    module: "leaguehustlestatsplayer",
    endpoint: "leaguehustlestatsplayer",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 30,
    retryProfile: "default",
    variants: [perGameVariant],
  },
  {
    module: "leaguehustlestatsteam",
    endpoint: "leaguehustlestatsteam",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 31,
    retryProfile: "default",
    variants: [perGameVariant],
  },
  {
    module: "playerestimatedmetrics",
    endpoint: "playerestimatedmetrics",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 32,
    retryProfile: "default",
    variants: [{ id: "default", params: { LeagueID: "00" } }],
  },
  {
    module: "teamestimatedmetrics",
    endpoint: "teamestimatedmetrics",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 33,
    retryProfile: "default",
    variants: [{ id: "default", params: { LeagueID: "00" } }],
  },
  {
    module: "leaguedashlineups",
    endpoint: "leaguedashlineups",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 34,
    retryProfile: "default",
    variants: [{ id: "base_per_game", params: { LeagueID: "00", PerMode: "PerGame", MeasureType: "Base" } }],
  },
  {
    module: "teamdashlineups",
    endpoint: "teamdashlineups",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 35,
    retryProfile: "default",
    variants: [{ id: "base_per_game", params: { LeagueID: "00", PerMode: "PerGame", MeasureType: "Base" } }],
  },
  {
    module: "leaguestandings",
    endpoint: "leaguestandings",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 36,
    retryProfile: "default",
    variants: [{ id: "default", params: { LeagueID: "00" } }],
  },
  {
    module: "leaguestandingsv3",
    endpoint: "leaguestandingsv3",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 37,
    retryProfile: "default",
    variants: [{ id: "default", params: { LeagueID: "00" } }],
  },
  {
    module: "leagueseasonmatchups",
    endpoint: "leagueseasonmatchups",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 38,
    retryProfile: "default",
    variants: [perGameVariant],
  },
  {
    module: "iststandings",
    endpoint: "iststandings",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 39,
    retryProfile: "default",
    variants: [{ id: "default", params: { LeagueID: "00" } }],
  },
  {
    module: "shotchartleaguewide",
    endpoint: "shotchartleaguewide",
    enabled: true,
    phase: "phase1",
    mode: "season",
    priority: 40,
    retryProfile: "default",
    variants: [{ id: "default", params: { LeagueID: "00" } }],
  },
];

const gameEndpoints: EndpointManifest[] = [
  "playbyplayv3",
  "boxscoretraditionalv3",
  "boxscoreadvancedv3",
  "boxscoremiscv3",
  "boxscorescoringv3",
  "boxscorefourfactorsv3",
  "boxscoreusagev3",
  "boxscoreplayertrackv3",
  "boxscorematchupsv3",
  "boxscoresummaryv3",
  "gamerotation",
  "winprobabilitypbp",
  "videoevents",
  "videodetails",
].map((module, index) => ({
  module,
  endpoint: module,
  enabled: true,
  phase: "phase1" as const,
  mode: "game" as const,
  priority: 60 + index,
  retryProfile: "default" as const,
  variants: [{ id: "default", params: {} }],
}));

export const INGEST_ENDPOINT_MANIFEST: EndpointManifest[] = [...seasonEndpoints, ...gameEndpoints];

export const SEASON_TYPES = ["Regular Season", "Playoffs", "Play-In"] as const;

export const INGEST_MANIFEST_BY_MODULE = new Map(INGEST_ENDPOINT_MANIFEST.map((entry) => [entry.module, entry] as const));
