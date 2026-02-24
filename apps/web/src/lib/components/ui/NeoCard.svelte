<script lang="ts">
	import type { Snippet } from 'svelte';

	type Tone = 'surface' | 'muted';
	type Props = {
		tone?: Tone;
		title: string;
		kicker?: string;
		children?: Snippet;
	};

	let { tone = 'surface', title, kicker, children }: Props = $props();
</script>

<article class={`neo-card neo-card--${tone}`}>
	<header class="neo-card__header">
		{#if kicker}
			<span class="neo-card__kicker">{kicker}</span>
		{/if}
		<span class="neo-card__title">{title}</span>
	</header>
	<div class="neo-card__body">
		{#if children}
			{@render children()}
		{/if}
	</div>
</article>
