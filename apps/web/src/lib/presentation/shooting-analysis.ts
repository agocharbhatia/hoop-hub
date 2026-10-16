import type { ArtifactViewState, ScatterChartArtifact, ShootingPoint } from '$lib/contracts/research-views';
import { presentTable, type TableArtifact } from './table-display';

export type ShootingViewPoint = ShootingPoint & { volume: number; percentage: number; percentile: number };

export function shootingDomain(points: readonly ShootingViewPoint[]) {
	const percentages = points.map(point => point.percentage);
	return { xMax: Math.max(1, ...points.map(point => point.volume)) * 1.12, yMin: Math.max(0, Math.floor((Math.min(30, ...percentages) - 3) / 5) * 5), yMax: Math.min(100, Math.ceil((Math.max(40, ...percentages) + 3) / 5) * 5) };
}

/* Population calculation helpers */

const sum = (points: readonly ShootingPoint[], key: 'attempts' | 'makes') => points.reduce((total, point) => total + point[key], 0);

/* End population calculation helpers */

/** References and percentiles always use every qualifying source row, independently of display order or selection. */
export function shootingView(artifact: ScatterChartArtifact, view: ArtifactViewState = {}) {
	const minimumAttempts = Math.max(artifact.qualification.floor, view.minimumAttempts ?? artifact.qualification.minimumAttempts);
	const rate = view.rate ?? artifact.rate;
	const qualified = artifact.points.filter(point => point.attempts >= minimumAttempts && point.attempts > 0);
	const sortedPercentages = qualified.map(point => point.makes / point.attempts).sort((a, b) => a - b);
	const ranks = new Map<number, number>();
	for (let first = 0; first < sortedPercentages.length;) { let last = first; while (last + 1 < sortedPercentages.length && sortedPercentages[last + 1] === sortedPercentages[first]) last++; ranks.set(sortedPercentages[first], qualified.length > 1 ? (first + last) / 2 / (qualified.length - 1) * 100 : 50); first = last + 1; }
	const points: ShootingViewPoint[] = qualified.map(point => ({ ...point, volume: rate === 'PerGame' ? point.attempts / point.games : point.attempts, percentage: point.makes / point.attempts * 100, percentile: ranks.get(point.makes / point.attempts)! }));
	const attempts = sum(qualified, 'attempts');
	return { points, rate, minimumAttempts, volumeLabel: rate === 'PerGame' ? '3PA / game' : '3PA', meanVolume: points.length ? points.reduce((total, point) => total + point.volume, 0) / points.length : null, combinedPercentage: attempts ? sum(qualified, 'makes') / attempts * 100 : null, attempts, populationCount: points.length };
}

/** A table is a second view of the same qualified population, never a separately retrieved ranking. */
export function shootingTable(artifact: ScatterChartArtifact, view: ArtifactViewState = {}): TableArtifact {
	const analysis = shootingView(artifact, view);
	const name = artifact.entity === 'team' ? 'teamName' : 'playerName';
	const volume = analysis.rate === 'PerGame' ? 'fg3aPerGame' : 'FG3A';
	const table = presentTable({ type: 'table', shape: 'ranking', columns: ['rank', name, volume, 'FG3_PCT', 'FG3M', 'FG3A', 'GP'].filter((column, index, columns) => columns.indexOf(column) === index), rows: [...analysis.points].sort((a, b) => b.percentage - a.percentage || b.attempts - a.attempts || a.id.localeCompare(b.id)).map((point, index) => ({ rank: index + 1, [name]: point.name, [volume]: point.volume, FG3_PCT: point.percentage / 100, FG3M: point.makes, FG3A: point.attempts, GP: point.games })), source: artifact.source }, { metrics: ['FG3_PCT', volume], entity: artifact.entity });
	table.display!.primaryColumns = ['rank', name, volume, 'FG3_PCT', 'FG3M', 'FG3A', 'GP'].filter((column, index, columns) => columns.indexOf(column) === index);
	return table;
}
