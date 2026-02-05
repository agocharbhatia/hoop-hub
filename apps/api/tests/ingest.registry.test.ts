import { test, expect } from "bun:test";
import { INGEST_ENDPOINT_MANIFEST, INGEST_MANIFEST_BY_MODULE } from "../src/ingest/registry";

test("phase1 manifest includes core season and game endpoint coverage", () => {
  expect(INGEST_ENDPOINT_MANIFEST.length).toBeGreaterThanOrEqual(38);

  const requiredModules = [
    "leaguedashplayerstats",
    "leaguedashteamstats",
    "leagueleaders",
    "leaguedashplayershotlocations",
    "playerestimatedmetrics",
    "teamestimatedmetrics",
    "playbyplayv3",
    "boxscoretraditionalv3",
    "boxscoreadvancedv3",
    "winprobabilitypbp",
    "videoevents",
    "videodetails",
  ];

  for (const module of requiredModules) {
    expect(INGEST_MANIFEST_BY_MODULE.has(module)).toBeTrue();
  }
});

test("manifest entries always contain at least one variant", () => {
  for (const item of INGEST_ENDPOINT_MANIFEST) {
    expect(item.variants.length).toBeGreaterThan(0);
    expect(item.module.length).toBeGreaterThan(0);
    expect(item.endpoint.length).toBeGreaterThan(0);
  }
});
