import { Hono } from "hono";
import { z } from "zod";
import { executeStatQuery } from "../services/statsService";

const router = new Hono();

const schema = z.object({
  statId: z.string(),
  entityType: z.enum(["player", "team", "game", "season", "league"]),
  entityIds: z.array(z.string()).optional(),
  season: z.string().optional(),
  seasonType: z.enum(["regular", "playoffs", "playin"]).optional(),
  filters: z.record(z.any()).optional(),
  groupBy: z.array(z.string()).optional(),
  orderBy: z.array(z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) })).optional(),
  limit: z.number().optional(),
});

router.post("/query", async (c) => {
  const body = await c.req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const result = await executeStatQuery(parsed.data);
  return c.json(result);
});

export default router;
