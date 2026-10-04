<script lang="ts">
	import type { EntityMedia } from '$lib/entities/entity-media';

	let { entity, size = 32, decorative = true, fallbackName = '' }: {
		entity: EntityMedia | null;
		size?: number;
		decorative?: boolean;
		fallbackName?: string;
	} = $props();
	let loadedUrl = $state('');
	let failedUrl = $state('');
	const displaySize = $derived(Number.isFinite(size) ? Math.max(16, Math.min(96, size)) : 32);
	const accessibleName = $derived(entity?.name || fallbackName || 'Unknown subject');
</script>

<span class="entity-avatar" class:team={entity?.kind === 'team'} style:--avatar-size={`${displaySize}px`}
	aria-hidden={decorative ? true : undefined} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : accessibleName}>
	<span class="avatar-fallback">{entity?.initials || fallbackName.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?'}</span>
	{#key entity?.imageUrl}
		{#if entity && failedUrl !== entity.imageUrl}
			<img src={entity.imageUrl} class:loaded={loadedUrl === entity.imageUrl} alt="" width={displaySize} height={displaySize} loading="lazy" decoding="async" referrerpolicy="no-referrer"
				onload={(event) => loadedUrl = (event.currentTarget as HTMLImageElement).src}
				onerror={(event) => failedUrl = (event.currentTarget as HTMLImageElement).src} />
		{/if}
	{/key}
</span>

<style>
	.entity-avatar { position: relative; display: inline-flex; align-items: center; justify-content: center; width: var(--avatar-size); height: var(--avatar-size); flex: 0 0 var(--avatar-size); overflow: hidden; border-radius: 50%; background: var(--color-muted); }
	.avatar-fallback { font-size: calc(var(--avatar-size) * .31); font-weight: 600; color: var(--color-muted-foreground); letter-spacing: -.02em; }
	.entity-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center top; opacity: 0; background: var(--color-muted); }
	.entity-avatar img.loaded { opacity: 1; }
	.entity-avatar.team { border-radius: 6px; background: transparent; }
	.entity-avatar.team img { object-fit: contain; background: var(--color-card); }
</style>
