import { expect, test } from "bun:test";
import { buildPresentationBlocks } from "../src/services/nlq/presentation";

test("preferred_views can reorder non-text blocks while policy remains deterministic", () => {
  const blocks = buildPresentationBlocks({
    intent: "comparison",
    query: "Compare Player A vs Player B points",
    explanation: "Showing 2 result(s)",
    stats: {
      columns: ["entity_name", "value", "stat"],
      rows: [
        { entity_name: "Player A", value: 31.2, stat: "PTS" },
        { entity_name: "Player B", value: 29.8, stat: "PTS" },
      ],
    },
    isShotQuery: false,
    hint: {
      goal: "comparison",
      preferred_views: ["table", "bar"],
      max_blocks: 4,
    },
  });

  expect(blocks.map((block) => block.type)).toEqual(["text", "table", "chart"]);
});

test("trend goal with season data chooses line chart", () => {
  const blocks = buildPresentationBlocks({
    intent: "stat",
    query: "Trend for Player A scoring",
    explanation: "Trend view",
    stats: {
      columns: ["season", "value"],
      rows: [
        { season: "2021-22", value: 22.1 },
        { season: "2022-23", value: 25.2 },
        { season: "2023-24", value: 27.3 },
      ],
    },
    isShotQuery: false,
    hint: {
      goal: "trend",
      preferred_views: ["line", "table"],
    },
  });

  expect(blocks.map((block) => block.type)).toEqual(["text", "chart", "table"]);
  const chart = blocks.find((block) => block.type === "chart");
  expect(chart?.type).toBe("chart");
  if (chart?.type === "chart") {
    expect(chart.chartType).toBe("line");
  }
});

test("max_blocks hint caps output size", () => {
  const blocks = buildPresentationBlocks({
    intent: "stat",
    query: "Shot profile for Player A",
    explanation: "Shot profile",
    isShotQuery: true,
    hint: {
      goal: "shot_profile",
      max_blocks: 2,
    },
    shotRows: [
      {
        game_id: "001",
        event_id: "11",
        x: 15,
        y: 90,
        shot_zone: "rim",
        shot_type: "layup",
        result: "Made Shot",
      },
      {
        game_id: "001",
        event_id: "12",
        x: -45,
        y: 160,
        shot_zone: "mid-range",
        shot_type: "pull-up",
        result: "Missed Shot",
      },
    ],
  });

  expect(blocks.length).toBe(2);
  expect(blocks[0].type).toBe("text");
});
