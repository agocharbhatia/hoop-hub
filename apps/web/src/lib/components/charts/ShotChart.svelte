<script lang="ts">
	import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';

	type ShotChartArtifact = Extract<QueryAnswerArtifact, { type: 'shot_chart' }>;
	type Shot = ShotChartArtifact['shots'][number];

	let { artifact }: { artifact: ShotChartArtifact } = $props();

	// NBA Stats shot coordinates: tenths of feet, hoop center at (0, 0),
	// baseline at y = -47.5, halfcourt at y = 422.5, sidelines at x = ±250.
	const COURT = { minX: -250, minY: -52.5, width: 500, height: 475 };
	const MADE_COLOR = '#3987e5';
	const MISS_COLOR = '#e66767';
	const LINE_COLOR = 'rgba(255, 255, 255, 0.28)';

	let hoveredShot = $state<{ shot: Shot; index: number } | null>(null);

	const shots = $derived(
		artifact.shots.filter(
			(shot) =>
				shot.locX >= COURT.minX &&
				shot.locX <= COURT.minX + COURT.width &&
				shot.locY >= COURT.minY &&
				shot.locY <= COURT.minY + COURT.height
		)
	);

	const madeCount = $derived(shots.filter((shot) => shot.made).length);
	const fgPercent = $derived(shots.length === 0 ? null : (madeCount / shots.length) * 100);

	function shotDistanceFeet(shot: Shot): number {
		return Math.round(Math.hypot(shot.locX, shot.locY) / 10);
	}

	function shotTooltip(shot: Shot): string {
		const outcome = shot.made ? 'Made' : 'Missed';
		const value = shot.value ? ` ${shot.value}PT` : '';
		return shot.label ?? `${outcome}${value} · ${shotDistanceFeet(shot)} ft`;
	}

	const tooltipPosition = $derived(
		hoveredShot === null
			? null
			: {
					leftPercent: ((hoveredShot.shot.locX - COURT.minX) / COURT.width) * 100,
					topPercent: ((hoveredShot.shot.locY - COURT.minY) / COURT.height) * 100
				}
	);
</script>

<figure class="w-full max-w-md">
	<figcaption class="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<span class="text-sm font-medium">{artifact.title}</span>
		{#if shots.length > 0}
			<span class="text-xs tabular-nums text-muted-foreground">
				{madeCount}/{shots.length} FG ({fgPercent?.toFixed(1)}%)
			</span>
		{/if}
	</figcaption>

	<div class="relative" role="img" aria-label="{artifact.title}: shot chart with {shots.length} shots, {madeCount} made">
		<svg
			viewBox="{COURT.minX} {COURT.minY} {COURT.width} {COURT.height}"
			class="block w-full rounded-md border border-border"
			role="presentation"
			onpointerleave={() => (hoveredShot = null)}
		>
			<!-- Court lines (NBA half court, hoop at origin, baseline at top) -->
			<g fill="none" stroke={LINE_COLOR} stroke-width="2">
				<!-- boundary -->
				<rect x="-250" y="-47.5" width="500" height="470" />
				<!-- hoop and backboard -->
				<circle cx="0" cy="0" r="7.5" />
				<line x1="-30" y1="-7.5" x2="30" y2="-7.5" stroke-width="3" />
				<!-- paint: outer and inner boxes, 19ft from baseline -->
				<rect x="-80" y="-47.5" width="160" height="190" />
				<rect x="-60" y="-47.5" width="120" height="190" />
				<!-- free-throw circle: solid top arc, dashed bottom arc -->
				<path d="M -60 142.5 A 60 60 0 0 0 60 142.5" />
				<path d="M 60 142.5 A 60 60 0 0 0 -60 142.5" stroke-dasharray="8 8" />
				<!-- restricted area -->
				<path d="M -40 0 A 40 40 0 0 0 40 0" />
				<!-- three-point line: corner lines to 14ft, arc r=237.5 -->
				<line x1="-220" y1="-47.5" x2="-220" y2="92.5" />
				<line x1="220" y1="-47.5" x2="220" y2="92.5" />
				<path d="M -220 92.5 A 237.5 237.5 0 0 0 220 92.5" />
				<!-- halfcourt circles -->
				<path d="M -60 422.5 A 60 60 0 0 1 60 422.5" />
				<path d="M -20 422.5 A 20 20 0 0 1 20 422.5" />
			</g>

			<!-- Shots: made = filled circle, miss = X (shape carries outcome, not color alone) -->
			{#each shots as shot, index}
				{#if shot.made}
					<circle cx={shot.locX} cy={shot.locY} r="6" fill={MADE_COLOR} opacity="0.85" />
				{:else}
					<g stroke={MISS_COLOR} stroke-width="3" stroke-linecap="round" opacity="0.85">
						<line x1={shot.locX - 5} y1={shot.locY - 5} x2={shot.locX + 5} y2={shot.locY + 5} />
						<line x1={shot.locX - 5} y1={shot.locY + 5} x2={shot.locX + 5} y2={shot.locY - 5} />
					</g>
				{/if}
				<circle
					cx={shot.locX}
					cy={shot.locY}
					r="11"
					fill="transparent"
					role="presentation"
					onpointerenter={() => (hoveredShot = { shot, index })}
				/>
			{/each}
		</svg>

		{#if hoveredShot !== null && tooltipPosition !== null}
			<div
				class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-md"
				style="left: {Math.min(85, Math.max(15, tooltipPosition.leftPercent))}%; top: {Math.max(8, tooltipPosition.topPercent - 3)}%"
			>
				{shotTooltip(hoveredShot.shot)}
			</div>
		{/if}
	</div>

	<p class="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground">
		<span class="flex items-center gap-1.5">
			<svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill={MADE_COLOR} /></svg>
			Made
		</span>
		<span class="flex items-center gap-1.5">
			<svg width="10" height="10" viewBox="0 0 10 10">
				<g stroke={MISS_COLOR} stroke-width="2" stroke-linecap="round">
					<line x1="1.5" y1="1.5" x2="8.5" y2="8.5" />
					<line x1="1.5" y1="8.5" x2="8.5" y2="1.5" />
				</g>
			</svg>
			Missed
		</span>
	</p>
</figure>
