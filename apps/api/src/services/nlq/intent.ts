import type { QueryIntent } from "../../types/domain";

export function classifyIntent(query: string): QueryIntent {
  const normalized = query.toLowerCase();
  const wantsClips = /(show|clip|video|every|all)/.test(normalized);
  const wantsComparison = /(compare|vs\.?|versus|than)/.test(normalized);
  const wantsStats = /(percent|%|points|efficiency|usage|rating|fg|true shooting|per)/.test(
    normalized
  );

  if (wantsClips && wantsStats) return "hybrid";
  if (wantsClips) return "clips";
  if (wantsComparison) return "comparison";
  return "stat";
}
