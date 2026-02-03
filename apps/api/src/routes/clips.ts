import { Hono } from "hono";
import { z } from "zod";
import { compileClips } from "../video/clipCompiler";

const router = new Hono();

const schema = z.object({
  urls: z.array(z.string().url()).min(1),
});

router.post("/compile", async (c) => {
  const body = await c.req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const result = await compileClips(parsed.data.urls, crypto.randomUUID());
  return c.json(result);
});

export default router;
