import { expect, test } from "bun:test";
import { __pbpServiceInternal } from "../src/services/pbpService";
import { __presentationInternal } from "../src/services/nlq/presentation";

test("normalizeHalfCourtPoint converts negative y to half-court and clamps bounds", () => {
  expect(__pbpServiceInternal.normalizeHalfCourtPoint(-300, -520)).toEqual({ x: -250, y: 470 });
  expect(__pbpServiceInternal.normalizeHalfCourtPoint(120, -110)).toEqual({ x: 120, y: 110 });
  expect(__pbpServiceInternal.normalizeHalfCourtPoint("abc", 10)).toBeNull();
});

test("buildShotZoneBlock aggregates attempts, makes, and fg%", () => {
  const zoneBlock = __presentationInternal.buildShotZoneBlock([
    {
      game_id: "001",
      event_id: "1",
      x: 10,
      y: 40,
      shot_zone: "rim",
      shot_type: "layup",
      result: "Made Shot",
    },
    {
      game_id: "001",
      event_id: "2",
      x: 20,
      y: 50,
      shot_zone: "rim",
      shot_type: "layup",
      result: "Missed Shot",
    },
    {
      game_id: "001",
      event_id: "3",
      x: -80,
      y: 180,
      shot_zone: "mid-range",
      shot_type: "pull-up",
      result: "Made Shot",
    },
  ]);

  expect(zoneBlock).not.toBeNull();
  if (!zoneBlock) return;
  expect(zoneBlock.zones[0].zone).toBe("rim");
  expect(zoneBlock.zones[0].attempts).toBe(2);
  expect(zoneBlock.zones[0].makes).toBe(1);
  expect(zoneBlock.zones[0].fg_pct).toBe(50);
});

test("stableSample produces deterministic subset", () => {
  const rows = Array.from({ length: 20 }, (_, idx) => ({ id: `row-${idx}` }));
  const first = __presentationInternal.stableSample(rows, 5, (row) => row.id).map((row) => row.id);
  const second = __presentationInternal.stableSample(rows, 5, (row) => row.id).map((row) => row.id);
  expect(first).toEqual(second);
  expect(first.length).toBe(5);
});
