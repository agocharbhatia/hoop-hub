import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';

export type Shot = Extract<QueryAnswerArtifact, { type: 'shot_chart' }>['shots'][number];
export type IndexedShot = { shot: Shot; index: number };
export type ShotBin = {
	key: string;
	x: number;
	y: number;
	width: number;
	height: number;
	attempts: number;
	makes: number;
	percentage: number;
};

// --- Coordinate and presentation helpers ---

// NBA coordinates are tenths of feet; every view shares these half-court bounds.
export const SHOT_COURT = { minX: -250, minY: -52.5, width: 500, height: 475 } as const;

export function isOnCourt(shot: Shot): boolean {
	return Number.isFinite(shot.locX) && Number.isFinite(shot.locY)
		&& shot.locX >= SHOT_COURT.minX && shot.locX <= SHOT_COURT.minX + SHOT_COURT.width
		&& shot.locY >= SHOT_COURT.minY && shot.locY <= SHOT_COURT.minY + SHOT_COURT.height;
}

export function describeShot(shot: Shot): string {
	const outcome = `${shot.made ? 'Made' : 'Missed'}${shot.value ? ` ${shot.value}PT` : ''}`;
	return shot.label ? `${outcome} · ${shot.label}` : `${outcome} · ${Math.round(Math.hypot(shot.locX, shot.locY) / 10)} ft`;
}

/** Court bounds limit drawing, not the research denominator; keep heaves in the population summary. */
export function summarizeShots(shots: readonly Shot[]): { attempts: number; makes: number; percentage: number | null } {
	const makes = shots.reduce((count, shot) => count + Number(shot.made), 0);
	return { attempts: shots.length, makes, percentage: shots.length ? makes / shots.length * 100 : null };
}

// --- End coordinate and presentation helpers ---

/** Keep the numerator and denominator together so percentage maps never average shot percentages. */
export function binShots(shots: readonly IndexedShot[], columns = 10, rows = 10): ShotBin[] {
	if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
		throw new RangeError('Shot bins require positive integer dimensions.');
	}
	const width = SHOT_COURT.width / columns;
	const height = SHOT_COURT.height / rows;
	const bins = new Map<string, ShotBin>();
	for (const { shot } of shots) {
		if (!isOnCourt(shot)) continue;
		const column = Math.min(columns - 1, Math.floor((shot.locX - SHOT_COURT.minX) / width));
		const row = Math.min(rows - 1, Math.floor((shot.locY - SHOT_COURT.minY) / height));
		const key = `${column}:${row}`;
		const bin = bins.get(key) ?? {
			key, x: SHOT_COURT.minX + column * width, y: SHOT_COURT.minY + row * height,
			width, height, attempts: 0, makes: 0, percentage: 0
		};
		bin.attempts += 1;
		bin.makes += Number(shot.made);
		bin.percentage = bin.makes / bin.attempts * 100;
		bins.set(key, bin);
	}
	return [...bins.values()];
}
