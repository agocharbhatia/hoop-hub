import { isOnCourt, type IndexedShot } from './shot-chart-utils';

export const SHOT_ZONES = [
	{ key: 'rim', label: 'At the rim', path: 'M-40,0 A40,40 0 1 1 40,0 A40,40 0 1 1 -40,0 Z', x: 0, y: -22 },
	{ key: 'paint', label: 'Paint · outside rim', path: 'M-80,-47.5 H80 V142.5 H-80 Z M-40,0 A40,40 0 1 1 40,0 A40,40 0 1 1 -40,0 Z', x: 0, y: 100 },
	{ key: 'mid', label: 'Mid-range', path: 'M-220,-47.5 H220 V92.5 A237.5,237.5 0 0 1 -220,92.5 Z M-80,-47.5 H80 V142.5 H-80 Z', x: 0, y: 195 },
	{ key: 'left', label: 'Left corner three', path: 'M-250,-47.5 H-220 V92.5 H-250 Z', x: -235, y: 25 },
	{ key: 'right', label: 'Right corner three', path: 'M220,-47.5 H250 V92.5 H220 Z', x: 235, y: 25 },
	{ key: 'above', label: 'Above-break three', path: 'M-250,92.5 H-220 A237.5,237.5 0 0 0 220,92.5 H250 V422.5 H-250 Z', x: 0, y: 335 }
] as const;

export type ShotZoneKey = typeof SHOT_ZONES[number]['key'];
export type ShotZoneSummary = typeof SHOT_ZONES[number] & { attempts: number; makes: number; percentage: number | null; shots: IndexedShot[] };

// --- Coordinate classification helpers ---

/** Spatial regions stay consistent with the drawn court; an explicit shot value takes precedence at the arc. */
export function shotZone({ shot }: IndexedShot): ShotZoneKey | null {
	if (!isOnCourt(shot)) return null;
	const distance = Math.hypot(shot.locX, shot.locY);
	const three = shot.value === 3 || (shot.value === undefined && (distance >= 237.5 || Math.abs(shot.locX) >= 220));
	if (three) return shot.locY <= 92.5 && Math.abs(shot.locX) >= 220 ? shot.locX < 0 ? 'left' : 'right' : 'above';
	if (distance <= 40) return 'rim';
	return Math.abs(shot.locX) <= 80 && shot.locY <= 142.5 ? 'paint' : 'mid';
}

// --- End coordinate classification helpers ---

/** Aggregate attempts once, retaining original identities for event and clip drill-through. */
export function summarizeShotZones(shots: readonly IndexedShot[]): ShotZoneSummary[] {
	const zones: ShotZoneSummary[] = SHOT_ZONES.map((zone) => ({ ...zone, attempts: 0, makes: 0, percentage: null, shots: [] }));
	const byKey = new Map(zones.map((zone) => [zone.key, zone]));
	for (const entry of shots) {
		const key = shotZone(entry);
		if (!key) continue;
		const zone = byKey.get(key)!;
		zone.attempts++;
		zone.makes += Number(entry.shot.made);
		zone.shots.push(entry);
	}
	for (const zone of zones) zone.percentage = zone.attempts ? zone.makes / zone.attempts * 100 : null;
	return zones;
}
