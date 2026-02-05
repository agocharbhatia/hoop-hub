import { z } from "zod";
import type {
  NLQResponse,
  PresentationBlock,
  PresentationChartBlock,
  PresentationDataValue,
  PresentationKpiBlock,
  PresentationShotChartZoneBlock,
  PresentationShotPoint,
  QueryIntent,
} from "../../types/domain";
import type { ShotVizRow } from "../pbpService";

const MAX_BLOCKS_HARD = 4;
const MAX_CHART_ROWS = 500;
const MAX_SHOT_POINTS = 1500;

const presentationGoalSchema = z.enum([
  "direct_answer",
  "ranking",
  "comparison",
  "trend",
  "distribution",
  "shot_profile",
  "clips",
]);

const presentationViewSchema = z.enum([
  "kpi",
  "table",
  "line",
  "bar",
  "scatter",
  "shot_xy",
  "shot_zone",
  "clips",
]);

const presentationHintSchema = z.object({
  goal: presentationGoalSchema.optional(),
  preferred_views: z.array(presentationViewSchema).default([]),
  max_blocks: z.number().int().min(1).max(MAX_BLOCKS_HARD).optional(),
});

export type PresentationGoal = z.infer<typeof presentationGoalSchema>;
export type PresentationView = z.infer<typeof presentationViewSchema>;
export type PresentationHint = z.infer<typeof presentationHintSchema>;

const dataValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const presentationTextBlockSchema = z.object({
  type: z.literal("text"),
  id: z.string().min(1),
  text: z.string().min(1),
  tone: z.enum(["answer", "note"]).optional(),
});

export const presentationKpiBlockSchema = z.object({
  type: z.literal("kpi"),
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.union([z.string(), z.number()]),
  subtitle: z.string().optional(),
});

export const presentationTableBlockSchema = z.object({
  type: z.literal("table"),
  id: z.string().min(1),
  title: z.string().optional(),
  columns: z.array(z.string().min(1)).min(1),
  rows: z.array(z.record(dataValueSchema)),
});

export const presentationChartBlockSchema = z.object({
  type: z.literal("chart"),
  id: z.string().min(1),
  title: z.string().optional(),
  chartType: z.enum(["line", "bar", "scatter"]),
  xKey: z.string().min(1),
  yKey: z.string().min(1),
  seriesKey: z.string().optional(),
  rows: z.array(z.record(dataValueSchema)),
});

export const presentationShotPointSchema = z.object({
  x: z.number(),
  y: z.number(),
  result: z.string(),
  shot_zone: z.string().optional(),
  shot_type: z.string().optional(),
  game_id: z.string().min(1),
  event_id: z.string().min(1),
});

export const presentationShotChartXyBlockSchema = z.object({
  type: z.literal("shot_chart_xy"),
  id: z.string().min(1),
  title: z.string().optional(),
  points: z.array(presentationShotPointSchema),
});

export const presentationShotZoneRowSchema = z.object({
  zone: z.string().min(1),
  attempts: z.number().int().nonnegative(),
  makes: z.number().int().nonnegative(),
  fg_pct: z.number().min(0).max(100),
});

export const presentationShotZoneBlockSchema = z.object({
  type: z.literal("shot_chart_zone"),
  id: z.string().min(1),
  title: z.string().optional(),
  zones: z.array(presentationShotZoneRowSchema),
});

export const presentationClipsBlockSchema = z.object({
  type: z.literal("clips"),
  id: z.string().min(1),
  title: z.string().optional(),
  items: z.array(
    z.object({
      gameId: z.string().min(1),
      eventId: z.string().min(1),
      url: z.string().optional(),
      videoAvailable: z.boolean(),
      durationMs: z.number().optional(),
    })
  ),
  compiledUrl: z.string().optional(),
  coverage: z.object({
    requested: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
  }),
});

export const presentationBlockSchema = z.discriminatedUnion("type", [
  presentationTextBlockSchema,
  presentationKpiBlockSchema,
  presentationTableBlockSchema,
  presentationChartBlockSchema,
  presentationShotChartXyBlockSchema,
  presentationShotZoneBlockSchema,
  presentationClipsBlockSchema,
]);

export const presentationEnvelopeSchema = z.object({
  version: z.literal(2),
  layout: z.literal("stack"),
  blocks: z.array(presentationBlockSchema).max(MAX_BLOCKS_HARD),
});

type BuildPresentationInput = {
  intent: QueryIntent;
  query: string;
  explanation: string;
  answer?: string;
  stats?: NLQResponse["stats"];
  clips?: NLQResponse["clips"];
  shotRows?: ShotVizRow[];
  isShotQuery: boolean;
  hint?: unknown;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toCellValue(value: unknown): PresentationDataValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function stableSample<T>(rows: T[], limit: number, keyFn: (row: T) => string): T[] {
  if (rows.length <= limit) return rows;
  const sorted = [...rows].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
  const sampled: T[] = [];
  const stride = sorted.length / limit;
  for (let i = 0; i < limit; i++) {
    sampled.push(sorted[Math.floor(i * stride)]);
  }
  return sampled;
}

function normalizeShotResult(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("made") || normalized.includes("make")) return "made";
  if (normalized.includes("missed") || normalized.includes("miss")) return "missed";
  return value || "unknown";
}

function buildShotZoneBlock(shotRows: ShotVizRow[]): PresentationShotChartZoneBlock | null {
  if (!shotRows.length) return null;
  const grouped = new Map<string, { attempts: number; makes: number }>();
  for (const row of shotRows) {
    const zone = row.shot_zone || "Unknown";
    const current = grouped.get(zone) ?? { attempts: 0, makes: 0 };
    current.attempts += 1;
    if (normalizeShotResult(row.result) === "made") current.makes += 1;
    grouped.set(zone, current);
  }

  const zones = Array.from(grouped.entries())
    .map(([zone, counts]) => {
      const fgPct = counts.attempts ? Number(((counts.makes / counts.attempts) * 100).toFixed(1)) : 0;
      return {
        zone,
        attempts: counts.attempts,
        makes: counts.makes,
        fg_pct: fgPct,
      };
    })
    .sort((a, b) => b.attempts - a.attempts);

  return {
    type: "shot_chart_zone",
    id: "shot-zone",
    title: "Shot Zones",
    zones,
  };
}

function buildShotXyBlock(shotRows: ShotVizRow[]) {
  if (!shotRows.length) return null;
  const sampled = stableSample(shotRows, MAX_SHOT_POINTS, (row) => `${row.game_id}:${row.event_id}`);
  const points: PresentationShotPoint[] = sampled.map((row) => ({
    x: row.x,
    y: row.y,
    result: normalizeShotResult(row.result),
    shot_zone: row.shot_zone || undefined,
    shot_type: row.shot_type || undefined,
    game_id: row.game_id,
    event_id: row.event_id,
  }));
  return {
    type: "shot_chart_xy" as const,
    id: "shot-xy",
    title: "Shot Chart (Half Court)",
    points,
  };
}

function hasRows(stats?: NLQResponse["stats"]) {
  return Boolean(stats?.rows?.length);
}

function rowsHaveKey(rows: Array<Record<string, string | number>>, keys: string[]) {
  if (!rows.length) return false;
  return keys.some((key) => rows.every((row) => row[key] !== undefined && row[key] !== null && row[key] !== ""));
}

function resolveTrendKey(rows: Array<Record<string, string | number>>) {
  const trendKeys = ["season", "date", "game_date", "timestamp"];
  for (const key of trendKeys) {
    if (rows.every((row) => row[key] !== undefined && row[key] !== null && row[key] !== "")) return key;
  }
  return null;
}

function resolveScatterKeys(rows: Array<Record<string, string | number>>) {
  if (!rows.length) return null;
  const keyCounts = new Map<string, number>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (toNumber(value) !== null) {
        keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const numericKeys = Array.from(keyCounts.entries())
    .filter(([, count]) => count >= Math.max(2, Math.floor(rows.length * 0.7)))
    .map(([key]) => key);
  if (numericKeys.length < 2) return null;
  const preferredX = numericKeys.find((key) => key !== "value" && key !== "rank");
  const xKey = preferredX ?? numericKeys[0];
  const yKey = numericKeys.find((key) => key !== xKey) ?? numericKeys[1];
  if (!xKey || !yKey) return null;
  return { xKey, yKey };
}

function buildTableFromStats(
  stats?: NLQResponse["stats"],
  fallbackZoneBlock?: PresentationShotChartZoneBlock
): PresentationBlock | null {
  if (stats?.columns?.length && stats.rows.length) {
    return {
      type: "table",
      id: "stats-table",
      title: "Stats",
      columns: stats.columns,
      rows: stats.rows.map((row) =>
        Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toCellValue(value)]))
      ),
    };
  }

  if (fallbackZoneBlock?.zones?.length) {
    return {
      type: "table",
      id: "shot-zone-table",
      title: "Shot Zone Breakdown",
      columns: ["zone", "attempts", "makes", "fg_pct"],
      rows: fallbackZoneBlock.zones.map((zone) => ({
        zone: zone.zone,
        attempts: zone.attempts,
        makes: zone.makes,
        fg_pct: zone.fg_pct,
      })),
    };
  }
  return null;
}

function buildKpiBlock(stats?: NLQResponse["stats"]): PresentationKpiBlock | null {
  const top = stats?.rows?.[0];
  if (!top) return null;
  const value = top.value;
  const label = String(top.entity_name ?? top.entity_id ?? "Leader");
  if (value === undefined || value === null) return null;
  const subtitle = top.stat ? String(top.stat) : top.stat_id ? String(top.stat_id) : undefined;
  return {
    type: "kpi",
    id: "top-kpi",
    label,
    value: typeof value === "number" ? Number(value.toFixed(2)) : String(value),
    subtitle,
  };
}

function buildBarChartBlock(stats?: NLQResponse["stats"]): PresentationChartBlock | null {
  if (!stats?.rows?.length) return null;
  const rows = stats.rows
    .map((row) => {
      const value = toNumber(row.value);
      if (value === null) return null;
      return {
        entity: String(row.entity_name ?? row.entity_id ?? "Unknown"),
        value,
        stat: String(row.stat ?? row.stat_id ?? ""),
      };
    })
    .filter((row): row is Record<string, string | number> => row !== null)
    .slice(0, MAX_CHART_ROWS);
  if (!rows.length) return null;

  return {
    type: "chart",
    id: "stats-bar",
    title: "Ranking",
    chartType: "bar",
    xKey: "entity",
    yKey: "value",
    rows,
  };
}

function buildLineChartBlock(stats?: NLQResponse["stats"]): PresentationChartBlock | null {
  if (!stats?.rows?.length) return null;
  const trendKey = resolveTrendKey(stats.rows);
  if (!trendKey) return null;
  const rows = stats.rows
    .map((row) => {
      const y = toNumber(row.value);
      if (y === null) return null;
      const x = row[trendKey];
      if (x === undefined || x === null || x === "") return null;
      return {
        x,
        y,
        entity: String(row.entity_name ?? row.entity_id ?? ""),
      };
    })
    .filter((row): row is Record<string, string | number> => row !== null)
    .slice(0, MAX_CHART_ROWS);
  if (!rows.length) return null;
  return {
    type: "chart",
    id: "stats-line",
    title: "Trend",
    chartType: "line",
    xKey: "x",
    yKey: "y",
    rows,
  };
}

function buildScatterChartBlock(stats?: NLQResponse["stats"]): PresentationChartBlock | null {
  if (!stats?.rows?.length) return null;
  const keys = resolveScatterKeys(stats.rows);
  if (!keys) return null;
  const rows = stats.rows
    .map((row) => {
      const x = toNumber(row[keys.xKey]);
      const y = toNumber(row[keys.yKey]);
      if (x === null || y === null) return null;
      return {
        x,
        y,
        entity: String(row.entity_name ?? row.entity_id ?? ""),
      };
    })
    .filter((row): row is Record<string, string | number> => row !== null)
    .slice(0, MAX_CHART_ROWS);
  if (!rows.length) return null;
  return {
    type: "chart",
    id: "stats-scatter",
    title: "Distribution",
    chartType: "scatter",
    xKey: "x",
    yKey: "y",
    rows,
  };
}

function viewForBlock(block: PresentationBlock): PresentationView | null {
  if (block.type === "kpi") return "kpi";
  if (block.type === "table") return "table";
  if (block.type === "clips") return "clips";
  if (block.type === "shot_chart_xy") return "shot_xy";
  if (block.type === "shot_chart_zone") return "shot_zone";
  if (block.type === "chart") return block.chartType;
  return null;
}

function sortByPreferredViews(blocks: PresentationBlock[], preferredViews: PresentationView[]) {
  if (!preferredViews.length) return blocks;
  const textBlocks = blocks.filter((block) => block.type === "text");
  const otherBlocks = blocks.filter((block) => block.type !== "text");
  const preferredOrder = new Map(preferredViews.map((view, idx) => [view, idx]));
  otherBlocks.sort((a, b) => {
    const aView = viewForBlock(a);
    const bView = viewForBlock(b);
    const aRank = aView ? preferredOrder.get(aView) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const bRank = bView ? preferredOrder.get(bView) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
  return [...textBlocks, ...otherBlocks];
}

function dedupeById(blocks: PresentationBlock[]) {
  const seen = new Set<string>();
  const deduped: PresentationBlock[] = [];
  for (const block of blocks) {
    if (seen.has(block.id)) continue;
    seen.add(block.id);
    deduped.push(block);
  }
  return deduped;
}

function buildPrimaryStatVisual(
  stats: NLQResponse["stats"] | undefined,
  shotRows: ShotVizRow[],
  shotZoneBlock: PresentationShotChartZoneBlock | null,
  hint: PresentationHint
): PresentationBlock | null {
  if (shotRows.length) {
    const shotXy = buildShotXyBlock(shotRows);
    if (shotXy) return shotXy;
  }
  if (shotZoneBlock) return shotZoneBlock;

  const preferred = hint.preferred_views;
  if (preferred.includes("line")) {
    const line = buildLineChartBlock(stats);
    if (line) return line;
  }
  if (preferred.includes("scatter")) {
    const scatter = buildScatterChartBlock(stats);
    if (scatter) return scatter;
  }
  if (preferred.includes("bar")) {
    const bar = buildBarChartBlock(stats);
    if (bar) return bar;
  }

  if (hint.goal === "trend") {
    const line = buildLineChartBlock(stats);
    if (line) return line;
  }
  if (hint.goal === "distribution") {
    const scatter = buildScatterChartBlock(stats);
    if (scatter) return scatter;
  }
  return buildBarChartBlock(stats) ?? buildLineChartBlock(stats) ?? buildScatterChartBlock(stats);
}

export function validateAndNormalizeBlocks(blocks: unknown, fallbackText: string): PresentationBlock[] {
  const parsed = z.array(presentationBlockSchema).safeParse(blocks);
  if (!parsed.success || parsed.data.length === 0) {
    return [{ type: "text", id: "fallback-text", text: fallbackText || "No results found.", tone: "note" }];
  }
  return parsed.data.slice(0, MAX_BLOCKS_HARD);
}

export function buildPresentationBlocks(input: BuildPresentationInput): PresentationBlock[] {
  const fallbackText = input.answer || input.explanation || "No results found.";
  const hint = presentationHintSchema.safeParse(input.hint).success
    ? presentationHintSchema.parse(input.hint)
    : { preferred_views: [] };

  const stats = input.stats;
  const clips = input.clips;
  const shotRows = input.shotRows ?? [];

  const hasStats = hasRows(stats);
  const hasClips = Boolean(clips);
  const hasShotRows = shotRows.length > 0;
  const shotRelated = input.isShotQuery || hasShotRows || hint.goal === "shot_profile";

  const blocks: PresentationBlock[] = [
    {
      type: "text",
      id: "summary-text",
      text: fallbackText,
      tone: input.answer ? "answer" : "note",
    },
  ];

  if (!hasStats && !hasClips && !hasShotRows) {
    return validateAndNormalizeBlocks(blocks, fallbackText);
  }

  const shotZoneBlock = buildShotZoneBlock(shotRows);
  const tableBlock = buildTableFromStats(stats, shotZoneBlock);
  const kpiBlock = buildKpiBlock(stats);
  const barBlock = buildBarChartBlock(stats);
  const lineBlock = buildLineChartBlock(stats);
  const scatterBlock = buildScatterChartBlock(stats);
  const shotXyBlock = buildShotXyBlock(shotRows);

  const isDirectAnswer = Boolean(input.answer && hasStats && stats?.rows.length === 1);
  const isTrend = hasStats && Boolean(resolveTrendKey(stats?.rows ?? []));
  const isDistribution = hasStats && Boolean(resolveScatterKeys(stats?.rows ?? []));

  if (input.intent === "clips" && !hasStats) {
    if (clips) {
      blocks.push({
        type: "clips",
        id: "clips",
        title: "Clips",
        items: clips.items,
        compiledUrl: clips.compiledUrl,
        coverage: clips.coverage,
      });
    }
    return validateAndNormalizeBlocks(sortByPreferredViews(dedupeById(blocks), hint.preferred_views), fallbackText);
  }

  if (input.intent === "hybrid" && clips) {
    const primary = buildPrimaryStatVisual(stats, shotRows, shotZoneBlock, hint);
    if (primary) blocks.push(primary);
    if (tableBlock) blocks.push(tableBlock);
    blocks.push({
      type: "clips",
      id: "clips",
      title: "Clips",
      items: clips.items,
      compiledUrl: clips.compiledUrl,
      coverage: clips.coverage,
    });
    const maxBlocks = Math.min(hint.max_blocks ?? MAX_BLOCKS_HARD, MAX_BLOCKS_HARD);
    const ordered = sortByPreferredViews(dedupeById(blocks), hint.preferred_views).slice(0, maxBlocks);
    return validateAndNormalizeBlocks(ordered, fallbackText);
  }

  if (shotRelated) {
    if (shotXyBlock) blocks.push(shotXyBlock);
    if (shotZoneBlock) blocks.push(shotZoneBlock);
    if (tableBlock) blocks.push(tableBlock);
    const maxBlocks = Math.min(hint.max_blocks ?? MAX_BLOCKS_HARD, MAX_BLOCKS_HARD);
    const ordered = sortByPreferredViews(dedupeById(blocks), hint.preferred_views).slice(0, maxBlocks);
    return validateAndNormalizeBlocks(ordered, fallbackText);
  }

  if (isDirectAnswer) {
    if (kpiBlock) blocks.push(kpiBlock);
    if (tableBlock) blocks.push(tableBlock);
    const maxBlocks = Math.min(hint.max_blocks ?? MAX_BLOCKS_HARD, MAX_BLOCKS_HARD);
    const ordered = sortByPreferredViews(dedupeById(blocks), hint.preferred_views).slice(0, maxBlocks);
    return validateAndNormalizeBlocks(ordered, fallbackText);
  }

  if ((input.intent === "comparison" || hint.goal === "comparison") && hasStats) {
    if (barBlock) blocks.push(barBlock);
    if (tableBlock) blocks.push(tableBlock);
    const maxBlocks = Math.min(hint.max_blocks ?? MAX_BLOCKS_HARD, MAX_BLOCKS_HARD);
    const ordered = sortByPreferredViews(dedupeById(blocks), hint.preferred_views).slice(0, maxBlocks);
    return validateAndNormalizeBlocks(ordered, fallbackText);
  }

  if (isTrend || hint.goal === "trend") {
    if (lineBlock) blocks.push(lineBlock);
    if (tableBlock) blocks.push(tableBlock);
    const maxBlocks = Math.min(hint.max_blocks ?? MAX_BLOCKS_HARD, MAX_BLOCKS_HARD);
    const ordered = sortByPreferredViews(dedupeById(blocks), hint.preferred_views).slice(0, maxBlocks);
    return validateAndNormalizeBlocks(ordered, fallbackText);
  }

  if (isDistribution || hint.goal === "distribution") {
    if (scatterBlock) blocks.push(scatterBlock);
    if (tableBlock) blocks.push(tableBlock);
    const maxBlocks = Math.min(hint.max_blocks ?? MAX_BLOCKS_HARD, MAX_BLOCKS_HARD);
    const ordered = sortByPreferredViews(dedupeById(blocks), hint.preferred_views).slice(0, maxBlocks);
    return validateAndNormalizeBlocks(ordered, fallbackText);
  }

  if (barBlock) blocks.push(barBlock);
  if (tableBlock) blocks.push(tableBlock);

  const maxBlocks = Math.min(hint.max_blocks ?? MAX_BLOCKS_HARD, MAX_BLOCKS_HARD);
  const ordered = sortByPreferredViews(dedupeById(blocks), hint.preferred_views).slice(0, maxBlocks);
  return validateAndNormalizeBlocks(ordered, fallbackText);
}

export const __presentationInternal = {
  buildShotZoneBlock,
  stableSample,
};
