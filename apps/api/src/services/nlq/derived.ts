import type { DerivedStatPlan } from "../../types/domain";

export function deriveStatPlan(query: string, baseStatId?: string): DerivedStatPlan | null {
  const normalized = query.toLowerCase();

  if (normalized.includes("usage-adjusted") && baseStatId) {
    return {
      formula: `${baseStatId} / USG_PCT`,
      inputs: [baseStatId, "USG_PCT"],
    };
  }

  if (normalized.includes("per touch") && baseStatId) {
    return {
      formula: `${baseStatId} / TOUCHES`,
      inputs: [baseStatId, "TOUCHES"],
    };
  }

  return null;
}
