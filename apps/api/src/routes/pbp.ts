import { Hono } from "hono";
import { z } from "zod";
import { executePbpQuery } from "../services/pbpService";

const router = new Hono();

const schema = z.object({
  season: z.string().optional(),
  seasonType: z.enum(["regular", "playoffs", "playin"]).optional(),
  gameIds: z.array(z.string()).optional(),
  teamIds: z.array(z.string()).optional(),
  playerIds: z.array(z.string()).optional(),
  defenderIds: z.array(z.string()).optional(),
  shotZone: z.array(z.string()).optional(),
  shotType: z.array(z.string()).optional(),
  playCategory: z.array(z.string()).optional(),
  coverageType: z.array(z.string()).optional(),
  clutch: z.boolean().optional(),
  dateRange: z
    .object({
      from: z.string(),
      to: z.string(),
    })
    .optional(),
  limit: z.number().optional(),
});

router.post("/query", async (c) => {
  const body = await c.req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const result = await executePbpQuery(parsed.data);
  return c.json(result);
});

export default router;
