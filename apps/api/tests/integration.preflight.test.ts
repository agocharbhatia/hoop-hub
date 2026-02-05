import { test, expect } from "bun:test";

const enabled = process.env.INTEGRATION_TESTS === "1";

// This test is intentionally opt-in because it hits real services.
// Run with docker-compose up -d and local env overrides.

test.skipIf(!enabled)("integration: preflight passes", async () => {
  const proc = Bun.spawn(["bun", "run", "preflight"], {
    cwd: process.cwd(),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const code = await proc.exited;
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();

  expect(err.trim()).toBe("");
  expect(code).toBe(0);

  const report = JSON.parse(out);
  expect(report.checks.clickhouse.ok).toBe(true);
  expect(report.checks.postgres.ok).toBe(true);
});
