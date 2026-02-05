export type EntityType = "player" | "team" | "game" | "season" | "league";

export type StatQuery = {
  statId: string;
  aggregationType?: string;
  numeratorField?: string;
  denominatorField?: string;
  entityType: EntityType;
  entityIds?: string[];
  season?: string;
  seasonType?: string;
  filters?: Record<string, string | number | boolean | string[] | number[]>;
  groupBy?: string[];
  orderBy?: { field: string; direction: "asc" | "desc" }[];
  limit?: number;
};

export type PbpQuery = {
  season?: string;
  seasonType?: string;
  gameIds?: string[];
  teamIds?: string[];
  playerIds?: string[];
  defenderIds?: string[];
  shotZone?: string[];
  shotType?: string[];
  playCategory?: string[];
  coverageType?: string[];
  clutch?: boolean;
  dateRange?: { from: string; to: string };
  limit?: number;
};

export type DerivedStatPlan = {
  formula: string;
  inputs: string[];
};

export type ClipRef = {
  gameId: string;
  eventId: string;
  url?: string;
  videoAvailable: boolean;
  durationMs?: number;
};

export type QueryIntent = "stat" | "comparison" | "clips" | "hybrid";

export type NLQRequest = {
  query: string;
};

export type NLQResponse = {
  intent: QueryIntent;
  explanation: string;
  answer?: string;
  showTable?: boolean;
  stats?: {
    columns: string[];
    rows: Array<Record<string, string | number>>;
  };
  clips?: {
    items: ClipRef[];
    compiledUrl?: string;
    coverage: { requested: number; available: number };
  };
  debug?: Record<string, unknown>;
};
