<script lang="ts">
	import type { Snippet } from 'svelte';

	type Variant = 'accent' | 'secondary' | 'surface';
	type ButtonType = 'button' | 'submit' | 'reset';

	type Props = {
		variant?: Variant;
		type?: ButtonType;
		fullWidth?: boolean;
		disabled?: boolean;
		onclick?: (() => void) | undefined;
		children?: Snippet;
	};

	let {
		variant = 'accent',
		type = 'button',
		fullWidth = false,
		disabled = false,
		onclick,
		children
	}: Props = $props();
</script>

<button
	class={`neo-button neo-button--${variant} ${fullWidth ? 'neo-button--full' : ''}`}
	{type}
	{disabled}
	{onclick}
>
	{#if children}
		{@render children()}
	{/if}
</button>
