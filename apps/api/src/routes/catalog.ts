import { Hono } from "hono";
import { searchCatalog } from "../services/catalog";

const router = new Hono();

router.get("/search", async (c) => {
  const term = c.req.query("q") ?? "";
  if (!term || term.length < 2) {
    return c.json({ error: "Missing query term" }, 400);
  }

  const results = await searchCatalog(term);
  return c.json({ results });
});

export default router;
