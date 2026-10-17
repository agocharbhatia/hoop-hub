import { resolvePlayerEntity, resolveTeamEntity, type EntityMedia } from '$lib/entities/entity-media';
import type { ShootingViewPoint } from './shooting-analysis';

export type EntityPlotMarker = { id: string; x: number; y: number; radius: number; entity: EntityMedia };
type MarkerOptions = { x: (value: number) => number; y: (value: number) => number; selectedIds?: readonly string[]; activeId?: string | null; compact?: boolean };
export const MAX_ENTITY_MARKERS = 64;

/** Photos stay at their measured coordinates; a spatial grid prevents dense populations becoming an overlapping image cloud. */
export function entityPlotMarkers(entity: 'player' | 'team', points: readonly ShootingViewPoint[], options: MarkerOptions): EntityPlotMarker[] {
	const selected = new Set(options.selectedIds ?? []);
	const priority = (id: string) => id === options.activeId ? 0 : selected.has(id) ? 1 : 2;
	const candidates = points.flatMap(point => {
		const media = entity === 'player' ? resolvePlayerEntity({ id: point.id, name: point.name }) : resolveTeamEntity({ id: point.id, name: point.name });
		return media ? [{ id: point.id, entity: media, x: options.x(point.volume), y: options.y(point.percentage), radius: priority(point.id) < 2 ? options.compact ? 14 : 17 : options.compact ? 11 : 13 }] : [];
	}).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)).sort((a, b) => priority(a.id) - priority(b.id) || a.id.localeCompare(b.id));
	const markers: EntityPlotMarker[] = [], grid = new Map<string, EntityPlotMarker[]>(), cellSize = 40;
	for (const candidate of candidates) {
		if (markers.length === MAX_ENTITY_MARKERS) break;
		const cellX = Math.floor(candidate.x / cellSize), cellY = Math.floor(candidate.y / cellSize);
		let overlaps = false;
		for (let dx = -1; dx <= 1 && !overlaps; dx++) for (let dy = -1; dy <= 1 && !overlaps; dy++) {
			for (const neighbor of grid.get(`${cellX + dx}:${cellY + dy}`) ?? []) if (Math.hypot(candidate.x - neighbor.x, candidate.y - neighbor.y) < candidate.radius + neighbor.radius + 4) { overlaps = true; break; }
		}
		if (overlaps && priority(candidate.id) === 2) continue;
		markers.push(candidate);
		const key = `${cellX}:${cellY}`; grid.set(key, [...grid.get(key) ?? [], candidate]);
	}
	return markers;
}
