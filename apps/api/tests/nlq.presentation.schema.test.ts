import { expect, test } from "bun:test";
import { presentationEnvelopeSchema, validateAndNormalizeBlocks } from "../src/services/nlq/presentation";

test("presentationEnvelopeSchema accepts valid block payload", () => {
  const payload = {
    version: 2,
    layout: "stack",
    blocks: [
      {
        type: "text",
        id: "summary-text",
        text: "Stephen Curry leads with 32.1 points per game.",
        tone: "answer",
      },
      {
        type: "table",
        id: "stats-table",
        columns: ["entity_name", "value"],
        rows: [{ entity_name: "Stephen Curry", value: 32.1 }],
      },
    ],
  };

  const parsed = presentationEnvelopeSchema.safeParse(payload);
  expect(parsed.success).toBe(true);
});

test("validateAndNormalizeBlocks returns a safe fallback when payload is invalid", () => {
  const normalized = validateAndNormalizeBlocks([{ foo: "bar" }], "Could not render blocks.");
  expect(normalized.length).toBe(1);
  expect(normalized[0].type).toBe("text");
  expect(normalized[0].id).toBe("fallback-text");
});

test("validateAndNormalizeBlocks enforces max block cap", () => {
  const normalized = validateAndNormalizeBlocks(
    [
      { type: "text", id: "t1", text: "a" },
      { type: "text", id: "t2", text: "b" },
      { type: "text", id: "t3", text: "c" },
      { type: "text", id: "t4", text: "d" },
      { type: "text", id: "t5", text: "e" },
    ],
    "fallback"
  );
  expect(normalized.length).toBe(4);
});
