<script lang="ts">
	import type { EntityMedia } from '$lib/entities/entity-media';
	import EntityAvatar from '$lib/components/entities/EntityAvatar.svelte';
	let { entity, radius, selected = false, inspected = false, muted = false }: { entity: EntityMedia; radius: number; selected?: boolean; inspected?: boolean; muted?: boolean } = $props();
	const clipId = $props.id();
</script>

<g class="entity-marker" class:muted class:selected class:inspected aria-hidden="true" pointer-events="none">
	<defs><clipPath id={clipId}><circle r={radius} /></clipPath></defs>
	<circle r={radius} class="marker-background" />
	<foreignObject x={-radius} y={-radius} width={radius * 2} height={radius * 2} clip-path={`url(#${clipId})`}><EntityAvatar {entity} size={radius * 2} decorative /></foreignObject>
	<circle r={radius + .5} class="marker-ring" />
</g>

<style>
	.entity-marker { opacity: .9; } .entity-marker.muted { opacity: .4; } .entity-marker.selected,.entity-marker.inspected { opacity: 1; } .marker-background { fill: #202831; } .marker-ring { fill: none; stroke: #72869e77; stroke-width: 1; } .selected .marker-ring { stroke: #99c7ff; stroke-width: 2; } .inspected .marker-ring { stroke: #edf5ff; stroke-width: 2; }
</style>
