import { Hono } from "hono";
import { z } from "zod";
import { handleNLQ } from "../services/nlq";

const router = new Hono();

const requestSchema = z.object({
  query: z.string().min(3),
});

router.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const response = await handleNLQ(parsed.data.query);
  return c.json(response);
});

export default router;
