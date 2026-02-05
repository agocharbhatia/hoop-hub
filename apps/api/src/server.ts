import { Hono } from "hono";
import { config } from "./config";
import nlqRoutes from "./routes/nlq";
import statsRoutes from "./routes/stats";
import pbpRoutes from "./routes/pbp";
import clipRoutes from "./routes/clips";
import catalogRoutes from "./routes/catalog";
import healthRoutes from "./routes/health";
import ingestRoutes from "./routes/ingest";

const app = new Hono();

app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204 as any);
  }
  await next();
});

app.get("/", (c) => c.json({ status: "ok", service: "hoophub-api" }));

app.route("/api/health", healthRoutes);
app.route("/api/nlq", nlqRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/pbp", pbpRoutes);
app.route("/api/clips", clipRoutes);
app.route("/api/catalog", catalogRoutes);
app.route("/api/ingest", ingestRoutes);

Bun.serve({
  fetch: app.fetch,
  port: config.port,
});

console.log(`HoopHub API listening on :${config.port}`);
