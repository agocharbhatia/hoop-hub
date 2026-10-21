<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { IconSearch, IconX } from '@tabler/icons-svelte';
	import EntityAvatar from '$lib/components/entities/EntityAvatar.svelte';
	import EntityPlotMarker from './EntityPlotMarker.svelte';
	import { entityPlotMarkers } from '$lib/presentation/entity-markers';
	import { resolvePlayerEntity, resolveTeamEntity } from '$lib/entities/entity-media';
	import type { ArtifactViewState, ScatterChartArtifact } from '$lib/contracts/research-views';
	import { shootingView, shootingDomain, type ShootingViewPoint } from '$lib/presentation/shooting-analysis';
	import { niceTicks, createLinearScale } from './chart-utils';

	let { artifact, initialView = {}, onviewchange }: { artifact: ScatterChartArtifact; initialView?: ArtifactViewState; onviewchange?: (view: ArtifactViewState) => void } = $props();
	let view = $state<ArtifactViewState>(untrack(() => ({ ...initialView })));
	let host: HTMLDivElement;
	let width = $state(640);
	let compact = $state(false);
	let inspected = $state<string | null>(null);
	let search = $state('');
	let sort = $state<'efficiency' | 'volume'>('efficiency');
	let visibleRanks = $state(10);
	let minimumError = $state('');
	const analysis = $derived(shootingView(artifact, view));
	const selected = $derived(view.selectedIds ?? []);
	const references = $derived(view.showReference ?? true);
	const height = 355;
	const componentId = $props.id();
	const domain = $derived(shootingDomain(analysis.points));
	const xMax = $derived(domain.xMax), yMin = $derived(domain.yMin), yMax = $derived(domain.yMax);
	const xScale = $derived(createLinearScale(0, xMax, 45, Math.max(100, width - 20)));
	const yScale = $derived(createLinearScale(yMin, yMax, height - 40, 24));
	const xTicks = $derived(niceTicks(0, xMax, Math.max(3, Math.floor(width / 120))));
	const yTicks = $derived(niceTicks(yMin, yMax, 4));
	const ranking = $derived([...analysis.points].sort((a, b) => (sort === 'efficiency' ? b.percentage - a.percentage : b.volume - a.volume) || b.attempts - a.attempts || a.id.localeCompare(b.id)));
	const matchingRanks = $derived(ranking.filter(point => !search.trim() || `${point.name} ${point.team ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));
	const ranked = $derived(matchingRanks.slice(0, visibleRanks));
	const active = $derived(analysis.points.find(point => point.id === inspected) ?? analysis.points.find(point => selected.includes(point.id)) ?? null);
	const markers = $derived(new Map(entityPlotMarkers(artifact.entity, analysis.points, { x: xScale, y: yScale, selectedIds: selected, activeId: active?.id, compact: width < 500 }).map(marker => [marker.id, marker])));
	const plotPoints = $derived([...analysis.points.filter(point => !selected.includes(point.id) && active?.id !== point.id), ...analysis.points.filter(point => selected.includes(point.id) && active?.id !== point.id), ...analysis.points.filter(point => active?.id === point.id)]);

	onMount(() => {
		const surface = host.closest('.shooting-explorer')!;
		const observer = new ResizeObserver(entries => {
			for (const entry of entries) {
				if (entry.target === host) width = Math.max(230, Math.round(entry.contentRect.width));
				else compact = entry.contentRect.width < 740;
			}
		});
		observer.observe(host); observer.observe(surface);
		return () => observer.disconnect();
	});
	$effect(() => { onviewchange?.(view); });
	$effect(() => { search; sort; visibleRanks = 10; });

	/* Chart interaction helpers */

	function update(change: ArtifactViewState) { view = { ...view, ...change }; }
	function qualify(event: Event) {
		const input = event.currentTarget as HTMLInputElement, value = Number(input.value);
		if (!input.value || !Number.isSafeInteger(value) || value < artifact.qualification.floor || value > 100000) {
			minimumError = `Use a minimum from ${artifact.qualification.floor.toLocaleString()} to 100,000 attempts.`;
			input.value = String(analysis.minimumAttempts);
			return;
		}
		minimumError = ''; update({ minimumAttempts: value });
	}
	function toggle(point: ShootingViewPoint) { inspected = point.id; update({ selectedIds: selected.includes(point.id) ? selected.filter(id => id !== point.id) : [...selected.slice(-7), point.id] }); }
	function media(point: ShootingViewPoint) { return artifact.entity === 'team' ? resolveTeamEntity({ id: point.id, name: point.name }) : resolvePlayerEntity({ id: point.id, name: point.name }); }
	function pointer(event: PointerEvent) {
		const svg = event.currentTarget as SVGSVGElement, bounds = svg.getBoundingClientRect();
		const x = (event.clientX - bounds.left) * width / bounds.width, y = (event.clientY - bounds.top) * height / bounds.height;
		let nearest: ShootingViewPoint | null = null, distance = 900;
		for (const point of analysis.points) { const candidate = (xScale(point.volume) - x) ** 2 + (yScale(point.percentage) - y) ** 2; if (candidate < distance) { nearest = point; distance = candidate; } }
		if (nearest) inspected = nearest.id;
	}
	function keyboard(event: KeyboardEvent) {
		if (!analysis.points.length) return;
		if (event.key === 'Enter' && active) { event.preventDefault(); toggle(active); return; }
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const index = Math.max(0, ranking.findIndex(point => point.id === active?.id));
		inspected = ranking[event.key === 'Home' ? 0 : event.key === 'End' ? ranking.length - 1 : Math.max(0, Math.min(ranking.length - 1, index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1)))].id;
	}
	function pointLabel(point: ShootingViewPoint) { return `${point.name}: ${point.volume.toFixed(1)} ${analysis.volumeLabel}, ${point.percentage.toFixed(1)}%, ${point.makes}/${point.attempts} 3P, ${point.games} games`; }

	/* End chart interaction helpers */
</script>

<section class="shooting-explorer" aria-label={artifact.title}>
	<div class="explorer-heading"><div><h3>{artifact.title}</h3><p>{artifact.scope.season} · {artifact.scope.seasonType} · {analysis.populationCount} {artifact.entity === 'team' ? 'teams' : 'players'}</p></div><div class="rate-switch" aria-label="Volume rate"><button type="button" aria-pressed={analysis.rate === 'PerGame'} onclick={() => update({ rate: 'PerGame' })}>Per game</button><button type="button" aria-pressed={analysis.rate === 'Totals'} onclick={() => update({ rate: 'Totals' })}>Totals</button></div></div>
	<div class="analysis-controls">
			<label>Min. 3PA <input aria-label="Minimum three-point attempts" aria-describedby={`${componentId}-minimum`} aria-invalid={Boolean(minimumError)} type="number" min={artifact.qualification.floor} max="100000" step="1" value={analysis.minimumAttempts} onchange={qualify} onblur={qualify} /></label>
			<label class="reference-toggle" title="Dashed lines show the qualified group's shooting percentage and average volume."><input type="checkbox" checked={references} onchange={(event) => update({ showReference: event.currentTarget.checked })} />Group benchmarks</label>
		{#if selected.length}<button type="button" class="clear" onclick={() => update({ selectedIds: [] })}><IconX size={12} />Clear {selected.length} selected</button>{/if}
	</div>
	<p id={`${componentId}-minimum`} class:qualification-error={Boolean(minimumError)} class:sr-only={!minimumError && artifact.qualification.floor === 0} class="qualification-hint" role={minimumError ? 'status' : undefined}>{minimumError || `Minimum supported: ${artifact.qualification.floor.toLocaleString()} attempts.`}</p>
	<div class="explorer-grid">
		<div class="plot-column">
			<div bind:this={host} class="plot-host">
				<svg viewBox={`0 0 ${width} ${height}`} role="listbox" aria-multiselectable="true" aria-activedescendant={active ? `${componentId}-${active.id}` : undefined} tabindex="0" aria-label="Three-point volume versus efficiency. Arrow keys inspect; Enter highlights a selection." onpointermove={pointer} onkeydown={keyboard}>
					{#each yTicks as tick}<line x1="45" x2={width - 20} y1={yScale(tick)} y2={yScale(tick)} class="grid-line" /><text x="36" y={yScale(tick) + 4} text-anchor="end" class="tick">{tick}%</text>{/each}
					{#each xTicks as tick}<text x={xScale(tick)} y={height - 18} text-anchor="middle" class="tick">{tick.toFixed(analysis.rate === 'PerGame' ? 1 : 0)}</text>{/each}
					<text x="45" y="12" class="axis-label">3P%</text><text x={width - 20} y={height - 2} text-anchor="end" class="axis-label">{analysis.volumeLabel}</text>
					{#if references && analysis.meanVolume !== null && analysis.combinedPercentage !== null}
						<line x1={xScale(analysis.meanVolume)} x2={xScale(analysis.meanVolume)} y1="24" y2={height - 40} class="reference-line" />
						<line x1="45" x2={width - 20} y1={yScale(analysis.combinedPercentage)} y2={yScale(analysis.combinedPercentage)} class="reference-line" />
					{/if}
					{#each plotPoints as point (point.id)}{@const marker = markers.get(point.id)}
						<g id={`${componentId}-${point.id}`} role="option" tabindex="-1" onkeydown={(event) => { event.stopPropagation(); keyboard(event); }} onfocus={() => inspected = point.id} aria-selected={selected.includes(point.id)} aria-label={pointLabel(point)} onclick={() => toggle(point)} transform={`translate(${xScale(point.volume)} ${yScale(point.percentage)})`} class="plot-point"><title>{pointLabel(point)}</title><circle r={selected.includes(point.id) || active?.id === point.id ? 5.5 : 3.5} class:selected={selected.includes(point.id)} class:inspected={active?.id === point.id} class:muted={selected.length > 0 && !selected.includes(point.id)} class="point" />{#if marker}<EntityPlotMarker entity={marker.entity} radius={marker.radius} selected={selected.includes(point.id)} inspected={active?.id === point.id} muted={selected.length > 0 && !selected.includes(point.id)} />{/if}<circle r={marker?.radius ?? 9} fill="transparent" /></g>
					{/each}
					{#each analysis.points.filter(point => selected.includes(point.id)) as point}<text x={Math.min(width - 24, Math.max(50, xScale(point.volume)))} y={Math.max(20, yScale(point.percentage) - (markers.get(point.id)?.radius ?? 5) - 8)} text-anchor={xScale(point.volume) > width * .7 ? 'end' : 'start'} class="point-label">{point.name.split(' ').slice(-1)[0]}</text>{/each}
					{#if !analysis.points.length}<text x={width / 2} y={height / 2} text-anchor="middle" class="empty-plot">No qualifying {artifact.entity === 'team' ? 'teams' : 'players'}</text>{/if}
				</svg>
			</div>
			{#if active}<div class="inspection" aria-live="polite"><button type="button" class="inspected-name" onclick={() => toggle(active)} aria-pressed={selected.includes(active.id)}>{active.name}</button><span>{active.volume.toFixed(1)} <small>{analysis.volumeLabel}</small></span><span>{active.percentage.toFixed(1)}% <small>3P</small></span><span>{active.makes}/{active.attempts} <small>3P</small></span><span>P{Math.round(active.percentile)}<small>qualified group</small></span></div>{:else}<div class="inspection muted-inspection"><span>{analysis.attempts.toLocaleString()} qualifying attempts</span><span>{artifact.populationLabel}</span></div>{/if}
			{#if references && analysis.combinedPercentage !== null}<div class="reference-values"><span><i></i>Group 3P% <strong>{analysis.combinedPercentage.toFixed(1)}%</strong></span><span>Mean {analysis.volumeLabel} <strong>{analysis.meanVolume!.toFixed(1)}</strong></span></div>{/if}
		</div>
		<aside class="ranking" aria-label="Synchronized shooting ranking">
				<details open={!compact}><summary class="ranking-summary">Qualified ranking · {matchingRanks.length} {search ? 'matches' : artifact.entity === 'team' ? 'teams' : 'players'}</summary>
			<div class="ranking-controls"><label class="search"><IconSearch size={13} /><input aria-label="Find a player or team" placeholder={artifact.entity === 'team' ? 'Find a team' : 'Find a player'} bind:value={search} /></label><label class="sort"><span class="sr-only">Rank by</span><select bind:value={sort}><option value="efficiency">3P%</option><option value="volume">{analysis.volumeLabel}</option></select></label></div>
			<ol>{#each ranked as point (point.id)}{@const entity = media(point)}<li><button type="button" class:chosen={selected.includes(point.id)} aria-pressed={selected.includes(point.id)} onclick={() => toggle(point)}><span class="rank">{ranking.indexOf(point) + 1}</span>{#if entity}<EntityAvatar {entity} size={28} decorative />{/if}<span class="name">{point.name}<small>{point.volume.toFixed(1)} {analysis.volumeLabel} · {point.attempts} att.</small></span><strong>{point.percentage.toFixed(1)}%</strong></button></li>{:else}<li class="no-matches">{search ? 'No matching names.' : 'Lower the minimum to include more results.'}</li>{/each}</ol>
				<p class="ranking-count">Showing {ranked.length} of {matchingRanks.length}{search ? ' matching results' : ' qualified results'}</p>
				{#if ranked.length < matchingRanks.length}<button type="button" class="show-more" onclick={() => visibleRanks += 10}>Show more results</button>{/if}
				</details>
		</aside>
	</div>
	{#if artifact.omittedRows > 0}<p class="coverage">{artifact.omittedRows} source {artifact.omittedRows === 1 ? 'row' : 'rows'} excluded before the comparable population.</p>{/if}
</section>

<style>
	.shooting-explorer { container: explorer / inline-size; min-width: 0; }
	.explorer-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
	h3 { font-size: 16px; font-weight: 550; letter-spacing: -.02em; } .explorer-heading p { color: var(--color-muted-foreground); font-size: 13px; margin-top: 5px; }
	.rate-switch { display: flex; padding: 3px; border: 1px solid var(--color-border); border-radius: 7px; flex-shrink: 0; } .rate-switch button { padding: 6px 9px; font-size: 13px; color: var(--color-muted-foreground); border-radius: 4px; } .rate-switch button[aria-pressed=true] { background: var(--color-control-active); color: var(--color-control-foreground); }
	.analysis-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 22px; font-size: 13px; color: var(--color-muted-foreground); padding-bottom: 17px; border-bottom: 1px solid var(--color-border); }
	.analysis-controls label { display: flex; align-items: center; gap: 8px; } input[type=number] { width: 70px; background: #ffffff04; border: 1px solid var(--color-border); border-radius: 5px; padding: 5px 7px; color: var(--color-foreground); font-variant-numeric: tabular-nums; } input[type=checkbox] { accent-color: #3987e5; } .clear { margin-left: auto; display: flex; gap: 5px; align-items: center; color: #a5cfff; }
	.explorer-grid { display: grid; grid-template-columns: minmax(0,1fr) 270px; gap: 24px; margin-top: 18px; } .plot-column, .plot-host { min-width: 0; } svg { display: block; width: 100%; height: 355px; touch-action: pan-y; } .grid-line { stroke: #ffffff0d; } .tick { fill: #a1a1aa; font: 10px var(--font-sans); } .axis-label { fill: #c0c4cd; font: 11px var(--font-sans); } .reference-line { stroke: #94a3b866; stroke-dasharray: 4 5; } .point { fill: #5799e6; fill-opacity: .7; } .point.muted { fill-opacity: .18; } .point.selected { fill: #9dcaff; stroke: #d9eaff; stroke-width: 1.5; fill-opacity: 1; } .point.inspected { stroke: #fff; stroke-width: 1.5; } .point-label { fill: var(--color-control-foreground); font: 10px var(--font-sans); paint-order: stroke; stroke: #1d1d1d; stroke-width: 4px; stroke-linejoin: round; } .empty-plot { fill: #a1a1aa; font: 12px var(--font-sans); }
	.inspection { min-height: 53px; display: flex; align-items: center; flex-wrap: wrap; gap: 10px 20px; border-top: 1px solid var(--color-border); padding: 12px 0; font-size: 12px; font-variant-numeric: tabular-nums; } .inspection small { display: block; color: var(--color-muted-foreground); font-size: 12px; margin-top: 3px; } .inspected-name { color: var(--color-action); font-weight: 500; text-align: left; margin-right: auto; } .muted-inspection { color: var(--color-muted-foreground); font-size: 13px; justify-content: space-between; } .reference-values { display: flex; flex-wrap: wrap; gap: 8px 22px; color: var(--color-muted-foreground); font-size: 12px; } .reference-values strong { color: var(--color-muted-foreground); font-weight: 500; margin-left: 4px; } .reference-values i { display: inline-block; width: 18px; border-top: 1px dashed #94a3b8; margin: 0 6px 3px 0; }
	.ranking { min-width: 0; border-left: 1px solid var(--color-border); padding-left: 18px; } .ranking-controls { display: flex; align-items: center; gap: 5px; margin-bottom: 10px; } .search { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--color-muted-foreground); } .search input { width: 100%; min-width: 0; font-size: 13px; background: transparent; padding: 7px 0; } .sort select { max-width: 85px; font-size: 12px; background: var(--color-card); color: var(--color-muted-foreground); padding: 5px; border-radius: 4px; } ol { max-height: 376px; overflow-y: auto; scrollbar-width: thin; } li button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 5px; border-radius: 5px; text-align: left; } li button:hover { background: #ffffff04; } li button.chosen { background: var(--color-selection); } .rank { color: var(--color-muted-foreground); font-size: 12px; width: 17px; flex-shrink: 0; font-variant-numeric: tabular-nums; } .name { min-width: 0; font-size: 13px; line-height: 1.5; } .name small { display: block; color: var(--color-muted-foreground); font-size: 12px; font-variant-numeric: tabular-nums; } li strong { margin-left: auto; font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; flex-shrink: 0; } .no-matches, .coverage { color: var(--color-muted-foreground); font-size: 13px; line-height: 1.6; padding: 10px 0; }
	button, select { cursor: pointer; } :focus-visible { outline: 2px solid var(--color-focus); outline-offset: 3px; }
	@container explorer (width < 740px) { .explorer-grid { grid-template-columns: minmax(0,1fr); gap: 18px; } .ranking { border-left: 0; border-top: 1px solid var(--color-border); padding: 12px 0 0; } ol { max-height: 250px; } .ranking-controls { justify-content: space-between; } .search { flex: 1; } .rate-switch { margin-top: 1px; } }
	@container explorer (width < 400px) { .explorer-heading { flex-direction: column; gap: 12px; } .analysis-controls { gap: 12px; } .clear { margin-left: 0; } .reference-toggle { font-size: 12px; } .inspection { gap: 12px; } .inspected-name { width: 100%; } }

	.qualification-hint, .ranking-count { font-size: 12px; color: var(--color-muted-foreground); line-height: 1.7; margin: 8px 0 14px; }
	.qualification-error { color: var(--color-warning); }
	.ranking-summary { cursor: pointer; min-height: 44px; align-content: center; font-size: 13px; color: var(--color-action); margin-bottom: 8px; }
	.show-more { min-height: 44px; color: var(--color-action); font-size: 13px; text-decoration: underline; text-underline-offset: 4px; }
	@container explorer (width < 740px) { ol { max-height: none; overflow: visible; } }
	@media (max-width: 850px) { .rate-switch button, .clear, .inspected-name, .sort select, .analysis-controls label { min-height: 44px; } .analysis-controls input[type=number], .search input { min-height: 44px; font-size: 16px; } .reference-toggle { padding: 7px 0; } }
</style>
