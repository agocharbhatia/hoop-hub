<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { IconArrowRight, IconBallBasketball } from '@tabler/icons-svelte';
	let email = $state('');
	let password = $state('');
	let token = $state('');
	let busy = $state(false);
	let error = $state('');
	onMount(() => {
		// Fragments never reach server access logs or referrer headers.
		token = new URLSearchParams(location.hash.slice(1)).get('invite') ?? '';
		if (token) history.replaceState(null, '', '/login');
	});
	async function submit(event: SubmitEvent) {
		event.preventDefault(); if (busy) return;
		busy = true; error = '';
		try {
			const response = await fetch(token ? '/api/auth/redeem' : '/api/auth/sign-in', {
				method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { token, password } : { email, password })
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error ?? 'Unable to sign in.');
			password = ''; token = ''; await invalidateAll(); await goto('/');
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Unable to sign in. Try again.'; }
		finally { busy = false; }
	}
</script>

<svelte:head><title>{token ? 'Welcome' : 'Sign in'} · Hoop Hub</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<main class="mx-auto flex w-full max-w-5xl flex-1 items-center px-6 py-14 sm:py-24">
	<div class="grid w-full gap-12 md:grid-cols-2 md:gap-20">
		<section>
			<a href="/" class="mb-12 flex items-center gap-2.5 text-lg font-semibold"><IconBallBasketball class="size-7 text-sky-400" />Hoop Hub <span class="rounded border border-sky-400/20 px-2 py-0.5 text-[10px] font-normal uppercase tracking-widest text-sky-300">Beta</span></a>
			<p class="text-xs uppercase tracking-[0.2em] text-sky-400">Your NBA research workspace</p>
			<h1 class="mt-4 text-4xl font-medium leading-tight tracking-tight">From a question<br />to the evidence.</h1>
			<p class="mt-5 max-w-sm text-sm leading-7 text-muted-foreground">Explore stats, inspect shots and watch the matching film. Keep your research and follow up whenever an answer sparks another question.</p>
		</section>
		<section class="self-center rounded-2xl border border-border bg-card/40 p-6 sm:p-8">
			<h2 class="text-xl font-medium tracking-tight">{token ? 'Make yourself at home' : 'Welcome back'}</h2>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">{token ? 'Choose a password to activate your invitation.' : 'Sign in to your private research workspace.'}</p>
			<form onsubmit={submit} class="mt-7 space-y-5">
				{#if !token}<div><label for="email" class="mb-2 block text-xs font-medium">Email</label><input id="email" type="email" autocomplete="username" bind:value={email} maxlength="254" required disabled={busy} class="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-sky-400" /></div>{/if}
				<div><label for="password" class="mb-2 block text-xs font-medium">{token ? 'Create a password' : 'Password'}</label><input id="password" type="password" autocomplete={token ? 'new-password' : 'current-password'} bind:value={password} minlength={token ? 15 : undefined} maxlength="128" required disabled={busy} class="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-sky-400" />{#if token}<p class="mt-2 text-xs leading-5 text-muted-foreground">At least 15 characters. Try a memorable passphrase.</p>{/if}</div>
				{#if error}<p role="alert" class="text-sm leading-6 text-amber-200">{error}</p>{/if}
				<button type="submit" disabled={busy} class="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-300 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-200 disabled:opacity-50">{busy ? 'One moment…' : token ? 'Start researching' : 'Sign in'}<IconArrowRight class="size-4" /></button>
			</form>
			<p class="mt-6 text-xs leading-6 text-muted-foreground">Access is by invitation. For an expired invite or a password reset, ask the person who invited you for a new link.</p>
		</section>
	</div>
</main>
