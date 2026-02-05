import { expect, test } from "bun:test";
import { buildPresentationBlocks } from "../src/services/nlq/presentation";

const baseStats = {
  columns: ["entity_name", "value", "stat"],
  rows: [
    { entity_name: "Player A", value: 31.2, stat: "PTS" },
    { entity_name: "Player B", value: 29.8, stat: "PTS" },
  ],
} as const;

const baseClips = {
  items: [{ gameId: "001", eventId: "15", videoAvailable: true, url: "https://example.com/clip.mp4" }],
  coverage: { requested: 1, available: 1 },
  compiledUrl: "https://example.com/compiled.mp4",
} as const;

test("direct answer uses text + kpi + table", () => {
  const blocks = buildPresentationBlocks({
    intent: "stat",
    query: "Who has the highest points this season?",
    answer: "Player A leads with 31.2 points per game.",
    explanation: "Player A leads.",
    stats: {
      columns: ["entity_name", "value", "stat"],
      rows: [{ entity_name: "Player A", value: 31.2, stat: "PTS" }],
    },
    isShotQuery: false,
  });
  expect(blocks.map((block) => block.type)).toEqual(["text", "kpi", "table"]);
});

test("comparison uses text + bar chart + table", () => {
  const blocks = buildPresentationBlocks({
    intent: "comparison",
    query: "Compare Player A and Player B points.",
    explanation: "Showing 2 results.",
    stats: baseStats,
    isShotQuery: false,
  });
  expect(blocks.map((block) => block.type)).toEqual(["text", "chart", "table"]);
  const chart = blocks.find((block) => block.type === "chart");
  expect(chart?.type).toBe("chart");
  if (chart?.type === "chart") {
    expect(chart.chartType).toBe("bar");
  }
});

test("shot query with coordinates uses text + shot xy + shot zone + table", () => {
  const blocks = buildPresentationBlocks({
    intent: "stat",
    query: "Show mid-range shot profile",
    explanation: "Showing shot profile.",
    isShotQuery: true,
    shotRows: [
      {
        game_id: "001",
        event_id: "7",
        x: -10,
        y: 140,
        shot_zone: "mid-range",
        shot_type: "pull-up",
        result: "Made Shot",
      },
      {
        game_id: "001",
        event_id: "8",
        x: 40,
        y: 190,
        shot_zone: "mid-range",
        shot_type: "pull-up",
        result: "Missed Shot",
      },
    ],
  });

  expect(blocks.map((block) => block.type)).toEqual(["text", "shot_chart_xy", "shot_chart_zone", "table"]);
});

test("clips-only query uses text + clips", () => {
  const blocks = buildPresentationBlocks({
    intent: "clips",
    query: "Show every pull-up three by Player A",
    explanation: "Found 1 clip",
    clips: baseClips,
    isShotQuery: false,
  });

  expect(blocks.map((block) => block.type)).toEqual(["text", "clips"]);
});

test("hybrid query uses text + primary visual + table + clips", () => {
  const blocks = buildPresentationBlocks({
    intent: "hybrid",
    query: "Compare points and show clips",
    explanation: "Showing stats and clips",
    stats: baseStats,
    clips: baseClips,
    isShotQuery: false,
  });

  expect(blocks.map((block) => block.type)).toEqual(["text", "chart", "table", "clips"]);
});

test("no data returns text only", () => {
  const blocks = buildPresentationBlocks({
    intent: "stat",
    query: "Unknown query",
    explanation: "No data found",
    isShotQuery: false,
  });
  expect(blocks.map((block) => block.type)).toEqual(["text"]);
});
