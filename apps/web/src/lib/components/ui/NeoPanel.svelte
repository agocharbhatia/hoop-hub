<script lang="ts">
	import type { Snippet } from 'svelte';

	type Variant = 'default' | 'tinted';
	type Props = {
		variant?: Variant;
		children?: Snippet;
	};

	let { variant = 'default', children }: Props = $props();
</script>

<section class={`neo-panel ${variant === 'tinted' ? 'neo-panel--tinted' : ''}`}>
	{#if children}
		{@render children()}
	{/if}
</section>
