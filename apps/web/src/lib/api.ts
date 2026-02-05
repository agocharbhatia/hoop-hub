const apiBase = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

export type NLQResponse = {
  intent: string;
  explanation: string;
  answer?: string;
  showTable?: boolean;
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
