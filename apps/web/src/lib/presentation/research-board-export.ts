import type { ResearchBoard, ResearchBoardItem } from '$lib/contracts/research-board';
import type { QueryEffectiveScope } from '$lib/contracts/query-context';
import { shootingView } from './shooting-analysis';
import { trendObservationUnit } from './trend-analysis';

/* Portable scope and view helpers */

function scopeLabel(scope?: QueryEffectiveScope): string {
	if (!scope) return '';
	return [
		...scope.seasons,
		...scope.seasonTypes ?? [],
		scope.dateFrom || scope.dateTo ? `${scope.dateFrom || 'Season start'} through ${scope.dateTo || 'Season end'}` : '',
		scope.period ? `Quarter ${scope.period}` : '',
		...scope.shotFilters ?? [],
		scope.opponents?.length ? `vs ${scope.opponents.map(opponent => opponent.name).join(', ')}` : ''
	].filter(Boolean).join(' · ');
}

function viewLabel(item: ResearchBoardItem): string {
	if (item.artifact?.type === 'split_comparison') return item.artifact.cohorts.map(cohort => `${cohort.label}: ${cohort.games} games${cohort.dateFrom ? ` (${cohort.dateFrom} through ${cohort.dateTo})` : ''}`).join(' · ') + ` · ${item.artifact.rate === 'PerGame' ? 'Per game' : 'Totals'}`;
	if (item.artifact?.type === 'scatter_chart') {
		const analysis = shootingView(item.artifact, item.view);
		const highlights = item.artifact.points.filter(point => item.view.selectedIds?.includes(point.id)).map(point => point.name);
		return [
			`${analysis.populationCount} qualified ${item.artifact.entity === 'team' ? 'teams' : 'players'} from ${item.artifact.points.length} source subjects`,
			`minimum ${analysis.minimumAttempts} 3PA`,
			analysis.volumeLabel,
			highlights.length ? `highlights: ${highlights.join(', ')}` : ''
		].filter(Boolean).join(' · ');
	}
	if (item.artifact?.type === 'line_chart') {
		return [
			(item.view.rollingWindow ?? 1) > 1 ? `${item.view.rollingWindow}-${trendObservationUnit(item.artifact)} rolling average` : 'Source values',
			item.view.showReference ? 'window mean reference' : ''
		].filter(Boolean).join(' · ');
	}
	return '';
}

/* End portable scope and view helpers */

/** A brief carries the saved analysis settings so its narrative remains reproducible away from the board. */
export function researchBoardMarkdown(board: ResearchBoard): string {
	const findings = board.items.map((item, index) => [
		`## ${index + 1}. ${item.artifact && 'title' in item.artifact ? item.artifact.title : item.artifact ? 'Research finding' : 'Note'}`,
		item.question ?? '',
		item.note,
		scopeLabel(item.scope),
		viewLabel(item),
		item.citations.map(citation => `Source: ${citation.source}${citation.detail ? ` · ${citation.detail}` : ''}`).join('\n'),
		`Snapshot saved: ${item.createdAt}`
	].filter(Boolean).join('\n\n'));
	return `# ${board.title}\n\n${findings.join('\n\n---\n\n')}\n`;
}
