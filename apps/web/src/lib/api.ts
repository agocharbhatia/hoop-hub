const apiBase = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

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
  chartType: "line" | "bar" | "scatter";
  xKey: string;
  yKey: string;
  seriesKey?: string;
  rows: Array<Record<string, PresentationDataValue>>;
};

export type PresentationShotChartXyBlock = {
  type: "shot_chart_xy";
  id: string;
  title?: string;
  points: Array<{
    x: number;
    y: number;
    result: string;
    shot_zone?: string;
    shot_type?: string;
    game_id: string;
    event_id: string;
  }>;
};

export type PresentationShotChartZoneBlock = {
  type: "shot_chart_zone";
  id: string;
  title?: string;
  zones: Array<{
    zone: string;
    attempts: number;
    makes: number;
    fg_pct: number;
  }>;
};

export type PresentationClipsBlock = {
  type: "clips";
  id: string;
  title?: string;
  items: { gameId: string; eventId: string; url?: string; videoAvailable: boolean; durationMs?: number }[];
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

export type NLQResponse = {
  intent: string;
  explanation: string;
  answer?: string;
  showTable?: boolean;
  presentation?: {
    version: 2;
    layout: "stack";
    blocks: PresentationBlock[];
  };
  stats?: { columns: string[]; rows: Record<string, string | number>[] };
  clips?: {
    items: { gameId: string; eventId: string; url?: string; videoAvailable: boolean }[];
    compiledUrl?: string;
    coverage: { requested: number; available: number };
  };
  debug?: Record<string, unknown>;
};

export type QuerySupport = {
  support: "supported" | "partial" | "not_supported";
  reason: string;
  statId?: string;
  module?: string;
  counts?: {
    ingested: number;
    blocked: number;
    failed: number;
    retry: number;
  };
};

export async function runQuery(query: string): Promise<NLQResponse> {
  const response = await fetch(`${apiBase}/api/nlq`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to run query");
  }

  return response.json();
}

export async function fetchQuerySupport(query: string): Promise<QuerySupport> {
  const response = await fetch(`${apiBase}/api/ingest/query-support`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to fetch query support");
  }

  return response.json();
}
