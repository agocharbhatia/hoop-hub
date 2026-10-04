<script lang="ts">
	import { describeShot, type IndexedShot, type Shot } from './shot-chart-utils';
	import { summarizeShotZones, type ShotZoneKey } from './shot-zones';
	let { shots, onselectshot }: { shots: IndexedShot[]; onselectshot?: (shot: Shot, index: number) => void } = $props();
	let selected = $state<ShotZoneKey | null>(null);
	let eventPage = $state(0);
	const zones = $derived(summarizeShotZones(shots));
	const active = $derived(zones.find((zone) => zone.key === selected));
	const page = $derived(Math.min(eventPage, Math.max(0, Math.ceil((active?.shots.length ?? 0) / 8) - 1)));
	// --- Zone presentation helpers ---
	function select(key: ShotZoneKey) { selected = key; eventPage = 0; }
	function color(percentage: number | null): string {
		return percentage === null ? 'rgba(255,255,255,.025)' : `rgba(57,135,229,${.1 + percentage / 100 * .65})`;
	}
	// --- End zone presentation helpers ---
</script>

<div class="zone-summary">
	<div class="zone-court">
		<svg viewBox="-250 -52.5 500 475" role="group" aria-label="Shooting by court zone">
			{#each zones as zone, index}
				<g role="button" tabindex="0" aria-pressed={selected === zone.key} aria-label="{zone.label}: {zone.makes} of {zone.attempts} made{zone.percentage === null ? '' : `, ${zone.percentage.toFixed(1)} percent`}" onclick={() => select(zone.key)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(zone.key); } }}>
					<path d={zone.path} fill={color(zone.percentage)} fill-rule="evenodd" stroke={selected === zone.key ? '#fff' : 'rgba(255,255,255,.25)'} stroke-width={selected === zone.key ? 3 : 1.5} />
					{#if zone.key === 'left' || zone.key === 'right' || zone.key === 'rim'}
						<text x={zone.x} y={zone.y + 6} text-anchor="middle" class="zone-number">{index + 1}</text>
					{:else}
						<text x={zone.x} y={zone.y} text-anchor="middle" class="zone-percent">{zone.percentage === null ? '—' : `${zone.percentage.toFixed(1)}%`}</text>
						<text x={zone.x} y={zone.y + 23} text-anchor="middle" class="zone-count">{zone.makes}/{zone.attempts} FG</text>
					{/if}
				</g>
			{/each}
			<g fill="none" stroke="rgba(255,255,255,.4)" stroke-width="2" pointer-events="none"><circle cx="0" cy="0" r="7.5" /><path d="M-30,-7.5 H30 M-60,142.5 A60,60 0 0 0 60,142.5" /></g>
		</svg>
		<p class="legend">FG% <span></span> 0–100%</p>
	</div>
	<div class="zone-list" aria-label="Zone shooting percentages">
		{#each zones as zone, index}
			<button type="button" class:chosen={selected === zone.key} aria-pressed={selected === zone.key} onclick={() => select(zone.key)}>
				<span class="zone-label"><span class="number">{index + 1}</span>{zone.label}</span>
				<strong>{zone.percentage === null ? '—' : `${zone.percentage.toFixed(1)}%`}</strong>
				<span class="sample">{zone.makes}/{zone.attempts} FG</span>
			</button>
		{/each}
	</div>
</div>
{#if active}
	<div class="zone-events" aria-live="polite">
		<div class="event-heading"><h4>{active.label}</h4><span>{active.attempts} attempts</span><button type="button" onclick={() => selected = null} aria-label="Close selected zone">Close</button></div>
		{#each active.shots.slice(page * 8, page * 8 + 8) as entry (entry.index)}
			<div class="event-row"><span>{describeShot(entry.shot)}{entry.shot.gameDate ? ` · ${entry.shot.gameDate}` : ''}</span>{#if onselectshot && entry.shot.gameId && entry.shot.eventId}<button type="button" onclick={() => onselectshot?.(entry.shot, entry.index)}>View shot →</button>{/if}</div>
		{:else}<p>No attempts in this zone.</p>{/each}
		{#if active.shots.length > 8}<nav aria-label="Zone attempt pages"><button type="button" disabled={page === 0} onclick={() => eventPage = page - 1}>Previous</button><span>{page * 8 + 1}–{Math.min(page * 8 + 8, active.shots.length)}</span><button type="button" disabled={(page + 1) * 8 >= active.shots.length} onclick={() => eventPage = page + 1}>Next</button></nav>{/if}
	</div>
{/if}

<style>
	.zone-summary { container-type: inline-size; display: grid; gap: 16px; grid-template-columns: minmax(0,1fr); }
	.zone-court { width: 100%; max-width: 420px; margin: auto; }
	svg { width: 100%; display: block; border-radius: 12px; background: rgba(57,135,229,.025); }
	svg g[role='button'] { cursor: pointer; }
	svg g[role='button']:focus-visible { outline: none; filter: drop-shadow(0 0 3px white); }
	text { fill: var(--color-foreground); pointer-events: none; font-variant-numeric: tabular-nums; }
	.zone-percent { font-size: 25px; font-weight: 650; }
	.zone-count { font-size: 17px; }
	.zone-number { font-size: 19px; font-weight: 650; }
	.legend { display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 10px; font-size: 11px; color: var(--color-muted-foreground); }
	.legend span { width: 80px; height: 6px; border-radius: 4px; background: linear-gradient(90deg,rgba(57,135,229,.1),rgba(57,135,229,.75)); }
	.zone-list { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
	.zone-list button { min-width: 0; text-align: left; padding: 12px; border: 1px solid var(--color-border); border-radius: 8px; cursor: pointer; }
	.zone-label { display: flex; gap: 6px; font-size: 12px; line-height: 1.4; }
	.number { color: var(--color-muted-foreground); }
	strong { display: block; font-size: 22px; font-weight: 600; letter-spacing: -.03em; margin-top: 8px; font-variant-numeric: tabular-nums; }
	.sample { display: block; font-size: 12px; color: var(--color-muted-foreground); margin-top: 3px; }
	.chosen { background: rgba(57,135,229,.12); border-color: #3987e5 !important; }
	button:focus-visible { outline: 2px solid #3987e5; outline-offset: 3px; }
	.zone-events { margin-top: 16px; border-top: 1px solid var(--color-border); font-size: 12px; }
	.event-heading, .event-row, nav { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 0; }
	h4 { font-weight: 600; }
	.event-heading > span { color: var(--color-muted-foreground); }
	.event-heading button { margin-left: auto; }
	.event-row { justify-content: space-between; border-top: 1px solid var(--color-border); }
	.event-row > span { flex: 1 1 180px; overflow-wrap: anywhere; }
	.zone-events button { min-height: 40px; cursor: pointer; padding: 4px 8px; color: var(--color-foreground); }
	button:disabled { opacity: .4; cursor: default; }
	nav { justify-content: space-between; }
	@container shot-artifact (min-width: 700px) { .zone-summary { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); align-items: center; } }
</style>
