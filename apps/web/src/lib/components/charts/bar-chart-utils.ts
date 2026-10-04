export type BarGeometry = {
	min: number;
	max: number;
	zero: number;
	position: (value: number) => { left: number; width: number };
};

// --- Zero-baseline geometry helpers ---

/** Keep every category on the same honest scale, including mixed signs and very large finite values. */
export function createBarGeometry(values: readonly number[]): BarGeometry {
	let min = 0;
	let max = 0;
	for (const value of values) {
		if (!Number.isFinite(value)) continue;
		min = Math.min(min, value);
		max = Math.max(max, value);
	}
	if (min === max) max = 1;

	// Normalize before subtracting so a mixed-sign domain cannot overflow.
	const magnitude = Math.max(Math.abs(min), Math.abs(max));
	const normalizedMin = min / magnitude;
	const span = max / magnitude - normalizedMin;
	const coordinate = (value: number) => (value / magnitude - normalizedMin) / span * 100;
	const zero = coordinate(0);
	return {
		min,
		max,
		zero,
		position(value) {
			const end = Number.isFinite(value) ? Math.max(0, Math.min(100, coordinate(value))) : zero;
			return { left: Math.min(zero, end), width: Math.abs(end - zero) };
		}
	};
}

// --- End zero-baseline geometry helpers ---
