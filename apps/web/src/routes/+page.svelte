<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { IconSend2, IconBallBasketball } from '@tabler/icons-svelte';
	import type { ErrorResponse } from '$lib/contracts/chat';
	import type { StatsQueryResponse } from '$lib/contracts/semantic-query';

	interface Message {
		id: string;
		role: 'user' | 'assistant';
		content: string;
		data?: StatsQueryResponse;
		timestamp: Date;
	}

	let messages = $state<Message[]>([]);
	let input = $state('');
	let isLoading = $state(false);
	let scrollContainer = $state<HTMLDivElement | null>(null);

	const suggestions = [
		'Who averaged the most assists in 2023-24?',
		'Show me Jokic rebounds in his last 10 games',
		'Compare Curry and Lillard career stats'
	];

	function scrollToBottom() {
		if (scrollContainer) {
			scrollContainer.scrollTop = scrollContainer.scrollHeight;
		}
	}

	async function sendMessage(content: string) {
		if (!content.trim() || isLoading) return;

		const userMessage: Message = {
			id: crypto.randomUUID(),
			role: 'user',
			content: content.trim(),
			timestamp: new Date()
		};

		messages = [...messages, userMessage];
		input = '';
		isLoading = true;

		setTimeout(scrollToBottom, 0);

		try {
			const result = await fetch('/api/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ question: content.trim() })
			});

			const data = (await result.json()) as StatsQueryResponse | ErrorResponse;

			const assistantMessage: Message = {
				id: crypto.randomUUID(),
				role: 'assistant',
				content: result.ok
					? (data as StatsQueryResponse).result?.summary ?? 'No results found for this query.'
					: 'error' in data
						? data.error
						: 'Unable to process this query.',
				data: result.ok ? (data as StatsQueryResponse) : undefined,
				timestamp: new Date()
			};

			messages = [...messages, assistantMessage];
		} catch {
			messages = [
				...messages,
				{
					id: crypto.randomUUID(),
					role: 'assistant',
					content: 'Request failed. Please try again.',
					timestamp: new Date()
				}
			];
		} finally {
			isLoading = false;
			setTimeout(scrollToBottom, 0);
		}
	}

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		sendMessage(input);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendMessage(input);
		}
	}
</script>

<svelte:head>
	<title>Hoop Hub</title>
</svelte:head>

<main class="flex-1 flex flex-col max-w-3xl mx-auto w-full">
	{#if messages.length === 0}
		<div class="flex-1 flex flex-col items-center justify-center px-4 py-12">
			<div class="flex items-center gap-2 mb-2">
				<IconBallBasketball class="size-8 text-primary" />
				<h1 class="text-2xl font-semibold tracking-tight">Hoop Hub</h1>
			</div>
			<p class="text-muted-foreground text-center mb-8">
				Ask anything about NBA stats
			</p>

			<div class="flex flex-wrap gap-2 justify-center max-w-lg">
				{#each suggestions as suggestion}
					<button
						type="button"
						class="px-3 py-2 text-sm rounded-2xl bg-muted hover:bg-muted/80 text-foreground transition-colors"
						onclick={() => sendMessage(suggestion)}
					>
						{suggestion}
					</button>
				{/each}
			</div>
		</div>
	{:else}
		<ScrollArea class="flex-1 px-4">
			<div class="py-6 space-y-6" bind:this={scrollContainer}>
				{#each messages as message (message.id)}
					<div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
						<div
							class="max-w-[85%] {message.role === 'user'
								? 'bg-primary text-primary-foreground'
								: 'bg-muted text-foreground'} rounded-2xl px-4 py-3"
						>
							<p class="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>

							{#if message.data?.result?.rows.length}
								<div class="mt-3 overflow-x-auto">
									<table class="w-full text-xs border-collapse">
										<thead>
											<tr class="border-b border-current/10">
												{#each message.data.result.columns as column}
													<th class="px-2 py-1.5 text-left font-medium opacity-70">{column}</th>
												{/each}
											</tr>
										</thead>
										<tbody>
											{#each message.data.result.rows as row}
												<tr class="border-b border-current/5 last:border-0">
													{#each message.data.result.columns as column}
														<td class="px-2 py-1.5">{row[column] ?? '—'}</td>
													{/each}
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}
						</div>
					</div>
				{/each}

				{#if isLoading}
					<div class="flex justify-start">
						<div class="bg-muted rounded-2xl px-4 py-3">
							<div class="flex items-center gap-1">
								<span class="size-2 bg-foreground/40 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
								<span class="size-2 bg-foreground/40 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
								<span class="size-2 bg-foreground/40 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</ScrollArea>
	{/if}

	<div class="sticky bottom-0 bg-background border-t border-border p-4">
		<form onsubmit={handleSubmit} class="flex items-center gap-2 max-w-3xl mx-auto">
			<Input
				type="text"
				placeholder="Ask about NBA stats..."
				bind:value={input}
				onkeydown={handleKeydown}
				disabled={isLoading}
				class="flex-1"
			/>
			<Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
				<IconSend2 class="size-4" />
				<span class="sr-only">Send message</span>
			</Button>
		</form>
	</div>
</main>
