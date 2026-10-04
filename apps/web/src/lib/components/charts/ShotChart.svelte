<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import { binShots, describeShot, isOnCourt, summarizeShots, SHOT_COURT as COURT, type IndexedShot, type Shot, type ShotBin } from './shot-chart-utils';

	type ShotChartArtifact = Extract<QueryAnswerArtifact, { type: 'shot_chart' }>;
	type View = 'shots' | 'density' | 'percentage';
	type Outcome = 'all' | 'made' | 'missed';

	let { artifact, onselectshot, selectedEvent = null }: {
		artifact: ShotChartArtifact;
		onselectshot?: (shot: Shot, originalIndex: number) => void;
		selectedEvent?: { gameId: string; eventId: string } | null;
	} = $props();

	const componentId = $props.id();
	const MADE_COLOR = '#3987e5';
	const MISS_COLOR = '#e66767';
	let view = $state<View>('shots');
	let outcome = $state<Outcome>('all');
	let minimumAttempts = $state(3);
	let inspectedIndex = $state<number | null>(null);
	let hoveredBin = $state<ShotBin | null>(null);
	let chartElement: SVGSVGElement;

	const shots = $derived(artifact.shots.map((shot, index) => ({ shot, index })).filter(({ shot }) => isOnCourt(shot)));
	const summary = $derived(summarizeShots(artifact.shots));
	const visibleShots = $derived(shots.filter(({ shot }) => outcome === 'all' || shot.made === (outcome === 'made')));
	// FG% always needs all attempts. A makes-only display must never become a 100% shooting map.
	const bins = $derived(binShots(view === 'percentage' ? shots : visibleShots));
	const maximumBinAttempts = $derived(Math.max(1, ...bins.map((bin) => bin.attempts)));
	const inspectedShot = $derived(visibleShots.find((entry) => entry.index === inspectedIndex) ?? null);
	const externalSelection = $derived(visibleShots.find(({ shot }) => selectedEvent !== null && shot.gameId === selectedEvent.gameId && shot.eventId === selectedEvent.eventId));
	const focusedIndex = $derived(inspectedShot?.index ?? externalSelection?.index ?? visibleShots[0]?.index);

	// An event chosen in a playlist must become visible and inspectable even after a local outcome filter.
	$effect(() => {
		const selection = selectedEvent;
		if (!selection) return;
		const index = artifact.shots.findIndex((shot) => shot.gameId === selection.gameId && shot.eventId === selection.eventId);
		if (index < 0) return;
		const shot = artifact.shots[index];
		untrack(() => {
			view = 'shots';
			if (outcome !== 'all' && shot.made !== (outcome === 'made')) outcome = 'all';
			hoveredBin = null;
			inspectedIndex = isOnCourt(shot) ? index : null;
		});
	});

	// --- Interaction and presentation helpers ---

	function binColor(bin: ShotBin): string {
		if (view === 'density') return `rgba(57, 135, 229, ${0.12 + Math.sqrt(bin.attempts / maximumBinAttempts) * 0.72})`;
		if (bin.attempts < minimumAttempts) return 'rgba(255, 255, 255, 0.06)';
		return `hsl(${220 - bin.percentage * 1.8} 72% 55% / 0.8)`;
	}

	function binDescription(bin: ShotBin): string {
		if (view === 'density') return outcome === 'all'
			? `${bin.attempts} attempts · ${bin.makes} makes`
			: `${bin.attempts} ${outcome === 'made' ? 'makes' : 'misses'}`;
		return `${bin.makes}/${bin.attempts} FG · ${bin.percentage.toFixed(1)}%${bin.attempts < minimumAttempts && view === 'percentage' ? ' · small sample' : ''}`;
	}

	function selectShot(entry: IndexedShot) {
		inspectedIndex = entry.index;
		onselectshot?.(entry.shot, entry.index);
	}

	/** Roving focus lets a season of shots remain one keyboard stop while every event stays reachable. */
	async function inspectAdjacent(direction: number, focusMarker = false) {
		if (!visibleShots.length) return;
		const current = visibleShots.findIndex((entry) => entry.index === focusedIndex);
		const next = (Math.max(0, current) + direction + visibleShots.length) % visibleShots.length;
		inspectedIndex = visibleShots[next].index;
		if (focusMarker) {
			await tick();
			chartElement?.querySelector<SVGElement>(`[data-shot-index="${inspectedIndex}"]`)?.focus();
		}
	}

	function handleShotKey(event: KeyboardEvent, entry: IndexedShot) {
		if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
			event.preventDefault();
			void inspectAdjacent(1, true);
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
			event.preventDefault();
			void inspectAdjacent(-1, true);
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			selectShot(entry);
		}
	}

	// --- End interaction and presentation helpers ---
</script>

<figure class="shot-artifact w-full">
	<figcaption class="mb-3 flex flex-wrap items-start justify-between gap-2">
		<div>
			<p class="text-sm font-medium">{artifact.title}</p>
			<p class="mt-1 text-xs tabular-nums text-muted-foreground">{summary.makes}/{summary.attempts} FG{summary.percentage === null ? '' : ` · ${summary.percentage.toFixed(1)}%`}{#if artifact.source?.sampled} · <abbr title="FG% and heatmaps describe a plotted sample of the matching attempts">Sample</abbr>{/if}</p>
		</div>
		<div class="segmented" aria-label="Court view">
			{#each [['shots', 'Shots'], ['density', 'Density'], ['percentage', 'FG%']] as [value, label]}
				<button type="button" aria-pressed={view === value} class:active={view === value} onclick={() => { view = value as View; hoveredBin = null; }}>{label}</button>
			{/each}
		</div>
	</figcaption>

	<div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
		<div class="segmented" aria-label="Shot outcome">
			{#each [['all', 'All attempts'], ['made', 'Makes'], ['missed', 'Misses']] as [value, label]}
				<button type="button" disabled={view === 'percentage'} aria-pressed={view === 'percentage' ? value === 'all' : outcome === value} class:active={view === 'percentage' ? value === 'all' : outcome === value} onclick={() => { outcome = value as Outcome; inspectedIndex = null; hoveredBin = null; }}>{label}</button>
			{/each}
		</div>
		{#if view === 'percentage'}
			<label class="flex items-center gap-2 text-muted-foreground">Min. attempts
				<select bind:value={minimumAttempts} class="rounded-md border border-border bg-card px-2 py-1 text-foreground" aria-label="Minimum attempts for colored FG percentage bins">
					<option value={1}>1</option><option value={3}>3</option><option value={5}>5</option><option value={10}>10</option>
				</select>
			</label>
		{:else}
			<span class="tabular-nums text-muted-foreground">{visibleShots.length} shown</span>
		{/if}
	</div>

	<div class="court-shell relative mx-auto w-full max-w-md">
		<svg bind:this={chartElement} viewBox="{COURT.minX} {COURT.minY} {COURT.width} {COURT.height}" class="block w-full rounded-xl border border-border" role="group" aria-label="{artifact.title}, {view === 'shots' ? 'shot locations' : view === 'density' ? 'attempt density' : 'field goal percentage map'}" aria-describedby="{componentId}-help">
			<defs>
				<pattern id="{componentId}-small-sample" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0,8 L8,0" stroke="rgba(255,255,255,.13)" stroke-width="1" /></pattern>
			</defs>
			{#if view !== 'shots'}
				{#each bins as bin (bin.key)}
					<g role="button" tabindex="0" aria-label={binDescription(bin)} onpointerenter={() => hoveredBin = bin} onpointerleave={() => hoveredBin = null} onfocus={() => hoveredBin = bin} onblur={() => hoveredBin = null} onclick={() => hoveredBin = bin} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); hoveredBin = bin; } }}>
						<rect x={bin.x + 1} y={bin.y + 1} width={bin.width - 2} height={bin.height - 2} rx="4" fill={binColor(bin)} />
						{#if view === 'percentage' && bin.attempts < minimumAttempts}<rect x={bin.x + 1} y={bin.y + 1} width={bin.width - 2} height={bin.height - 2} rx="4" fill="url(#{componentId}-small-sample)" />{/if}
					</g>
				{/each}
			{/if}

			<!-- Court geometry is shared by the event and aggregate views. -->
			<g fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2" pointer-events="none">
				<rect x="-250" y="-47.5" width="500" height="470" />
				<circle cx="0" cy="0" r="7.5" /><line x1="-30" y1="-7.5" x2="30" y2="-7.5" stroke-width="3" />
				<rect x="-80" y="-47.5" width="160" height="190" /><rect x="-60" y="-47.5" width="120" height="190" />
				<path d="M -60 142.5 A 60 60 0 0 0 60 142.5" /><path d="M 60 142.5 A 60 60 0 0 0 -60 142.5" stroke-dasharray="8 8" />
				<path d="M -40 0 A 40 40 0 0 0 40 0" />
				<line x1="-220" y1="-47.5" x2="-220" y2="92.5" /><line x1="220" y1="-47.5" x2="220" y2="92.5" />
				<path d="M -220 92.5 A 237.5 237.5 0 0 0 220 92.5" />
				<path d="M -60 422.5 A 60 60 0 0 1 60 422.5" /><path d="M -20 422.5 A 20 20 0 0 1 20 422.5" />
			</g>

			{#if view === 'shots'}
				{#each visibleShots as entry (entry.index)}
					{@const highlighted = inspectedShot?.index === entry.index || (!inspectedShot && externalSelection?.index === entry.index)}
					<g role="button" tabindex={focusedIndex === entry.index ? 0 : -1} data-shot-index={entry.index} aria-label="{describeShot(entry.shot)}{entry.shot.gameDate ? ` · ${entry.shot.gameDate}` : ''}{entry.shot.period ? ` · Q${entry.shot.period}` : ''}" aria-pressed={externalSelection?.index === entry.index} onpointerenter={() => inspectedIndex = entry.index} onfocus={() => inspectedIndex = entry.index} onclick={() => selectShot(entry)} onkeydown={(event) => handleShotKey(event, entry)}>
						{#if highlighted}<circle cx={entry.shot.locX} cy={entry.shot.locY} r="12" fill="none" stroke="var(--color-foreground)" stroke-width="2" />{/if}
						{#if entry.shot.made}<circle cx={entry.shot.locX} cy={entry.shot.locY} r="5.5" fill={MADE_COLOR} opacity=".9" />
						{:else}<path d="M{entry.shot.locX - 4.5},{entry.shot.locY - 4.5}l9,9 M{entry.shot.locX - 4.5},{entry.shot.locY + 4.5}l9,-9" stroke={MISS_COLOR} stroke-width="2.5" stroke-linecap="round" opacity=".9" />{/if}
						<circle cx={entry.shot.locX} cy={entry.shot.locY} r="10" fill="transparent" />
					</g>
				{/each}
			{/if}
		</svg>
		{#if (view === 'percentage' ? shots.length : visibleShots.length) === 0}
			<p class="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-muted-foreground">No attempts in this view.</p>
		{/if}
	</div>

	<div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
		{#if view === 'shots'}
			<p><span style="color: {MADE_COLOR}">●</span> Made <span class="ml-3" style="color: {MISS_COLOR}">×</span> Missed</p>
			<div class="flex items-center gap-1"><button type="button" class="inspect-button" disabled={!visibleShots.length} onclick={() => inspectAdjacent(-1)} aria-label="Inspect previous shot">←</button><button type="button" class="inspect-button" disabled={!visibleShots.length} onclick={() => inspectAdjacent(1)} aria-label="Inspect next shot">→</button></div>
		{:else if view === 'density'}
			<p class="flex items-center gap-2">Fewer <span class="density-key h-2 w-20 rounded-sm"></span> More {outcome === 'all' ? 'attempts' : outcome === 'made' ? 'makes' : 'misses'}</p>
		{:else}
			<p class="flex items-center gap-2">0% <span class="percentage-key h-2 w-20 rounded-sm"></span> 100%</p>
			<span>Hatched = fewer than {minimumAttempts} attempts</span>
		{/if}
	</div>

	<div class={(view === 'shots' ? inspectedShot : hoveredBin) ? 'detail-panel mt-3 rounded-lg border border-border px-3 py-2 text-xs' : 'sr-only'} aria-live="polite" aria-atomic="true">
		{#if view === 'shots' && inspectedShot}
			<p class="font-medium">{describeShot(inspectedShot.shot)}</p>
			<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
				{#if inspectedShot.shot.gameDate}<span>{inspectedShot.shot.gameDate}</span>{/if}
				{#if inspectedShot.shot.period}<span>Q{inspectedShot.shot.period}</span>{/if}
				{#if onselectshot && inspectedShot.shot.gameId && inspectedShot.shot.eventId}<button type="button" class="text-foreground underline underline-offset-4" onclick={() => selectShot(inspectedShot)}>Find matching clip →</button>{/if}
			</div>
		{:else if view !== 'shots' && hoveredBin}
			<p class="font-medium tabular-nums">{binDescription(hoveredBin)}</p>
		{/if}
	</div>
	<p id="{componentId}-help" class="sr-only">{view === 'shots' ? `Use arrow keys to inspect shots.${onselectshot ? ' Press Enter or Space to find a matching clip.' : ''}` : 'Focus a court area to inspect its count and sample size.'}</p>
	{#if shots.length < artifact.shots.length}<details class="coordinate-note mt-2 text-xs text-muted-foreground"><summary>{artifact.shots.length - shots.length} attempts not plotted</summary><p class="mt-1 leading-5">Attempts without half-court coordinates are included in the FG summary.</p></details>{/if}
</figure>

<style>
	.segmented { display: flex; flex-wrap: wrap; max-width: 100%; gap: 2px; padding: 3px; border: 1px solid var(--color-border); border-radius: 9px; background: rgba(0,0,0,.08); }
	.segmented button { min-height: 40px; border-radius: 6px; padding: 6px 9px; color: var(--color-muted-foreground); font-size: 12px; cursor: pointer; transition: color .15s, background .15s; }
	.segmented button.active { background: var(--color-card); color: var(--color-foreground); box-shadow: 0 1px 3px rgba(0,0,0,.15); }
	.segmented button:disabled { cursor: default; opacity: .65; }
	button:focus-visible, select:focus-visible { outline: 2px solid #3987e5; outline-offset: 3px; }
	.court-shell { background: radial-gradient(ellipse at 50% 5%, rgba(57,135,229,.06), transparent 65%); }
	svg g[role='button'] { cursor: pointer; }
	svg g[role='button']:focus-visible { outline: none; filter: drop-shadow(0 0 3px white); }
	.inspect-button { width: 40px; height: 40px; border-radius: 6px; border: 1px solid var(--color-border); color: var(--color-foreground); cursor: pointer; }
	select { min-height: 40px; }
	.inspect-button:disabled { opacity: .4; cursor: default; }
	.density-key { background: linear-gradient(to right, rgba(57,135,229,.12), rgba(57,135,229,.85)); }
	.percentage-key { background: linear-gradient(to right, hsl(220 72% 55%), hsl(130 72% 55%), hsl(40 72% 55%)); }
	.detail-panel { background: rgba(0,0,0,.05); }
	abbr { text-decoration: none; }
	.coordinate-note summary { cursor: pointer; }
	.coordinate-note summary:focus-visible { outline: 2px solid #3987e5; outline-offset: 3px; }
</style>
