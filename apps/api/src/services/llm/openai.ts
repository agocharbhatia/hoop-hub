import { z } from "zod";
import { config } from "../../config";

export const openAiNlqPlanSchema = z.object({
  intent: z.enum(["stat", "comparison", "clips", "hybrid"]),
  stat_search_term: z.string().min(1).nullable(),
  entities: z.object({
    players: z.array(z.string()).default([]),
    teams: z.array(z.string()).default([]),
  }),
  time: z
    .object({
      season: z.string().nullable(),
      season_type: z.enum(["regular", "playoffs", "playin"]).nullable(),
      since_season: z.string().nullable(),
    })
    .default({ season: null, season_type: null, since_season: null }),
  filters: z
    .object({
      shot_zone: z.array(z.string()).default([]),
      shot_type: z.array(z.string()).default([]),
      play_category: z.array(z.string()).default([]),
      coverage_type: z.array(z.string()).default([]),
      clutch: z.boolean().nullable(),
      defender: z.array(z.string()).default([]),
    })
    .default({
      shot_zone: [],
      shot_type: [],
      play_category: [],
      coverage_type: [],
      clutch: null,
      defender: [],
    }),
  output: z
    .object({
      want_table: z.boolean().default(true),
      want_clips: z.boolean().default(false),
      compile: z.boolean().default(false),
      limit: z.number().int().min(1).max(500).default(50),
    })
    .default({ want_table: true, want_clips: false, compile: false, limit: 50 }),
});

export type OpenAiNlqPlan = z.infer<typeof openAiNlqPlanSchema>;

function jsonSchemaForNlqPlan() {
  // Strict JSON schema subset: avoid complex keywords.
  return {
    type: "object",
    additionalProperties: false,
    required: ["intent", "stat_search_term", "entities", "time", "filters", "output"],
    properties: {
      intent: {
        type: "string",
        enum: ["stat", "comparison", "clips", "hybrid"],
      },
      stat_search_term: { type: ["string", "null"] },
      entities: {
        type: "object",
        additionalProperties: false,
        required: ["players", "teams"],
        properties: {
          players: { type: "array", items: { type: "string" } },
          teams: { type: "array", items: { type: "string" } },
        },
      },
      time: {
        type: "object",
        additionalProperties: false,
        required: ["season", "season_type", "since_season"],
        properties: {
          season: { type: ["string", "null"] },
          season_type: {
            type: ["string", "null"],
            enum: ["regular", "playoffs", "playin", null],
          },
          since_season: { type: ["string", "null"] },
        },
      },
      filters: {
        type: "object",
        additionalProperties: false,
        required: [
          "shot_zone",
          "shot_type",
          "play_category",
          "coverage_type",
          "clutch",
          "defender",
        ],
        properties: {
          shot_zone: { type: "array", items: { type: "string" } },
          shot_type: { type: "array", items: { type: "string" } },
          play_category: { type: "array", items: { type: "string" } },
          coverage_type: { type: "array", items: { type: "string" } },
          clutch: { type: ["boolean", "null"] },
          defender: { type: "array", items: { type: "string" } },
        },
      },
      output: {
        type: "object",
        additionalProperties: false,
        required: ["want_table", "want_clips", "compile", "limit"],
        properties: {
          want_table: { type: "boolean" },
          want_clips: { type: "boolean" },
          compile: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: 500 },
        },
      },
    },
  };
}

export async function planNlqWithOpenAI(query: string): Promise<OpenAiNlqPlan> {
  if (!config.llmApiKey) {
    throw new Error("LLM_API_KEY is not configured");
  }

  // IMPORTANT: Use path-join semantics. `new URL("/responses", "https://.../v1")` would drop `/v1`.
  const base = config.llm.baseUrl.replace(/\/+$/, "");
  const url = `${base}/responses`;

  const instructions = [
    "You are a query planner for an NBA stats + video engine.",
    "Return ONLY a JSON object that matches the provided schema.",
    "Rules:",
    "- Do not invent player/team IDs. Use plain names as strings.",
    "- If a stat is referenced, set stat_search_term to the phrase users would search in a stat catalog (e.g. 'true shooting %', 'mid-range FG%').",
    "- season should be a 4-digit year if specified (e.g. '2022'). If the user says 'this season' and you don't know the current season, leave season null.",
    "- season_type: regular|playoffs|playin only when explicitly stated.",
    "- shot_zone examples: ['mid-range','rim','three'].",
    "- shot_type examples: ['pull-up','catch-and-shoot'].",
    "- play_category examples: ['isolation'].",
    "- coverage_type examples: ['drop','switch'].",
    "- If the user asks to 'show' or 'every/all clips', set output.want_clips=true.",
    "- intent is 'hybrid' when both stats and clips are requested.",
  ].join("\n");

  const body = {
    model: config.llm.model,
    input: query,
    instructions,
    reasoning: { effort: config.llm.reasoningEffort },
    text: {
      format: {
        type: "json_schema",
        name: "nlq_plan",
        description: "Structured plan for NBA NLQ engine",
        strict: true,
        schema: jsonSchemaForNlqPlan(),
      },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llmApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${text}`);
  }

  const payload = await response.json();
  const outputText =
    typeof payload?.output_text === "string"
      ? payload.output_text
      : Array.isArray(payload?.output)
        ? payload.output
            .filter((o: any) => o?.type === "message")
            .flatMap((o: any) => o?.content ?? [])
            .find((c: any) => c?.type === "output_text")?.text
        : null;

  if (!outputText || typeof outputText !== "string") {
    throw new Error("OpenAI response did not include output_text");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(outputText);
  } catch {
    throw new Error("OpenAI response was not valid JSON");
  }

  return openAiNlqPlanSchema.parse(parsedJson);
}
