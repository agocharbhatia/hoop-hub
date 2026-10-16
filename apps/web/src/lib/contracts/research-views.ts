import type { QueryArtifactSource } from './answer-response';

export type ResearchRate = 'PerGame' | 'Totals';
export const SEASON_INPUT_PATTERN = '(?:19|20)[0-9]{2}-[0-9]{2}';
export type ArtifactViewState = { minimumAttempts?: number; rate?: ResearchRate; selectedIds?: string[]; rollingWindow?: number; showReference?: boolean };
export type ShootingPoint = { id: string; name: string; team?: string; games: number; attempts: number; makes: number };

/** Totals preserve the denominator needed to requalify a population without estimating from rounded rates. */
export type ScatterChartArtifact = {
	type: 'scatter_chart';
	title: string;
	entity: 'player' | 'team';
	points: ShootingPoint[];
	qualification: { minimumAttempts: number; floor: number };
	rate: ResearchRate;
	scope: { season: string; seasonType: string; dateFrom?: string; dateTo?: string };
	populationLabel: string;
	omittedRows: number;
	source: QueryArtifactSource;
};

export type ResearchRefinement = { season?: string; dateFrom?: string; dateTo?: string; rate?: ResearchRate; minimumAttempts?: number };
export type ResearchRefineRequest = { sessionId: string; turnId: string; artifactIndex: number; changes: ResearchRefinement };

export const ARTIFACT_VIEW_LIMITS = { selectedIds: 8, minimumAttempts: 100_000, rollingWindow: 20 } as const;

/** One bounded contract is shared by board snapshots, chart controls and portable exports. */
export function validArtifactView(value: unknown): value is ArtifactViewState {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const view = value as Record<string, unknown>;
	return Object.keys(view).every(key => ['minimumAttempts', 'rate', 'selectedIds', 'rollingWindow', 'showReference'].includes(key))
		&& (view.minimumAttempts === undefined || Number.isSafeInteger(view.minimumAttempts) && Number(view.minimumAttempts) >= 0 && Number(view.minimumAttempts) <= ARTIFACT_VIEW_LIMITS.minimumAttempts)
		&& (view.rate === undefined || view.rate === 'PerGame' || view.rate === 'Totals')
		&& (view.rollingWindow === undefined || Number.isSafeInteger(view.rollingWindow) && Number(view.rollingWindow) >= 1 && Number(view.rollingWindow) <= ARTIFACT_VIEW_LIMITS.rollingWindow)
		&& (view.showReference === undefined || typeof view.showReference === 'boolean')
		&& (view.selectedIds === undefined || Array.isArray(view.selectedIds) && view.selectedIds.length <= ARTIFACT_VIEW_LIMITS.selectedIds && view.selectedIds.every(id => typeof id === 'string' && /^\d{1,12}$/.test(id)));
}
