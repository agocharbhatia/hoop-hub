<script lang="ts">
	import type { Snippet } from 'svelte';

	type Tone = 'default' | 'accent' | 'muted';
	type Props = {
		tone?: Tone;
		children?: Snippet;
	};

	let { tone = 'default', children }: Props = $props();
</script>

<span class={`neo-badge ${tone === 'accent' ? 'neo-badge--accent' : ''} ${tone === 'muted' ? 'neo-badge--muted' : ''}`}>
	{#if children}
		{@render children()}
	{/if}
</span>
