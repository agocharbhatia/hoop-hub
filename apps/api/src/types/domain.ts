export type EntityType = "player" | "team" | "game" | "season" | "league";
export type PresentationLayout = "stack";
export type PresentationChartType = "line" | "bar" | "scatter";
export type PresentationDataValue = string | number | boolean | null;

export type PresentationTextBlock = {
  type: "text";
  id: string;
  text: string;
  tone?: "answer" | "note";
};

export type PresentationKpiBlock = {
  type: "kpi";
  id: string;
  label: string;
  value: string | number;
  subtitle?: string;
};

export type PresentationTableBlock = {
  type: "table";
  id: string;
  title?: string;
  columns: string[];
  rows: Array<Record<string, PresentationDataValue>>;
};

export type PresentationChartBlock = {
  type: "chart";
  id: string;
  title?: string;
  chartType: PresentationChartType;
  xKey: string;
  yKey: string;
  seriesKey?: string;
  rows: Array<Record<string, PresentationDataValue>>;
};

export type PresentationShotPoint = {
  x: number;
  y: number;
  result: string;
  shot_zone?: string;
  shot_type?: string;
  game_id: string;
  event_id: string;
};

export type PresentationShotChartXyBlock = {
  type: "shot_chart_xy";
  id: string;
  title?: string;
  points: PresentationShotPoint[];
};

export type PresentationShotZoneRow = {
  zone: string;
  attempts: number;
  makes: number;
  fg_pct: number;
};

export type PresentationShotChartZoneBlock = {
  type: "shot_chart_zone";
  id: string;
  title?: string;
  zones: PresentationShotZoneRow[];
};

export type PresentationClipsBlock = {
  type: "clips";
  id: string;
  title?: string;
  items: ClipRef[];
  compiledUrl?: string;
  coverage: { requested: number; available: number };
};

export type PresentationBlock =
  | PresentationTextBlock
  | PresentationKpiBlock
  | PresentationTableBlock
  | PresentationChartBlock
  | PresentationShotChartXyBlock
  | PresentationShotChartZoneBlock
  | PresentationClipsBlock;

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
  presentation?: {
    version: 2;
    layout: PresentationLayout;
    blocks: PresentationBlock[];
  };
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
