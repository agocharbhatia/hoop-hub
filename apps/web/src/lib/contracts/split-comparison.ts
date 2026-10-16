import type { QueryArtifactSource } from './answer-response';

export const SPLIT_METRICS = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'MIN', 'FGA', 'FG3A', 'FTA', 'FG_PCT', 'FG3_PCT', 'FT_PCT', 'TS_PCT', 'EFG_PCT', 'FG3_SHARE'] as const;
export type SplitMetric = typeof SPLIT_METRICS[number];
export type SplitBasis = 'date' | 'halves' | 'home_away' | 'win_loss' | 'seasons';
export type SplitComparisonRequest = {
	entity: 'player' | 'team'; subjectId: string; season: string; seasonType: 'Regular Season' | 'Playoffs';
	basis: SplitBasis; metrics: SplitMetric[]; rate: 'PerGame' | 'Totals';
	cutoff?: string; comparisonSeason?: string; dateFrom?: string; dateTo?: string;
};
export type SplitCohort = { label: string; season: string; games: number; dateFrom?: string; dateTo?: string };
export type SplitMetricValue = {
	key: SplitMetric; label: string; unit: string; precision: number; preference: 'higher' | 'lower' | null;
	values: [number | null, number | null];
	support: Array<{ label: string; values: [number | null, number | null] }>;
};
export type SplitComparisonArtifact = {
	type: 'split_comparison'; title: string;
	subject: { entity: 'player' | 'team'; id: string; name: string };
	basis: SplitBasis; seasonType: string; rate: 'PerGame' | 'Totals';
	cohorts: [SplitCohort, SplitCohort]; metrics: SplitMetricValue[];
	limitations: string[]; source: QueryArtifactSource;
};
