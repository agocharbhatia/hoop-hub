<script lang="ts">
	import { browser } from '$app/environment';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { IconSend2, IconBallBasketball } from '@tabler/icons-svelte';
	import BarChart from '$lib/components/charts/BarChart.svelte';
	import LineChart from '$lib/components/charts/LineChart.svelte';
	import ShotChart from '$lib/components/charts/ShotChart.svelte';
	import VideoPlaylist from '$lib/components/video/VideoPlaylist.svelte';
	import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
	import type { ErrorResponse } from '$lib/contracts/chat';
	import {
		getAssistantMessageContent,
		getChartPlaceholderArtifacts,
		getPrimaryTableArtifact,
		getSupportingTableArtifacts,
		getTextBlockArtifacts,
		getVideoPlaylistArtifacts,
		getVisibleWarningMessages
	} from '$lib/presentation/query-response';

	interface Message {
		id: string;
		role: 'user' | 'assistant';
		content: string;
		data?: QueryAnswerResponse;
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
		if (!browser || !content.trim() || isLoading) return;

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
			const result = await window.fetch('/api/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ question: content.trim() })
			});

			const data = (await result.json()) as QueryAnswerResponse | ErrorResponse;

			const assistantMessage: Message = {
				id: crypto.randomUUID(),
				role: 'assistant',
				content: getAssistantMessageContent(result.ok, data),
				data: result.ok ? (data as QueryAnswerResponse) : undefined,
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

	function getMessageTable(message: Message) {
		return message.data ? getPrimaryTableArtifact(message.data) : null;
	}

	function getMessageSupportingTables(message: Message) {
		return message.data ? getSupportingTableArtifacts(message.data) : [];
	}

	function getMessageTextBlocks(message: Message) {
		if (!message.data) {
			return [];
		}

		return getTextBlockArtifacts(message.data).filter(
			(artifact) => artifact.text.trim() !== message.content.trim()
		);
	}

	function getMessageWarnings(message: Message) {
		return message.data ? getVisibleWarningMessages(message.data) : [];
	}

	function getMessageChartPlaceholders(message: Message) {
		return message.data ? getChartPlaceholderArtifacts(message.data) : [];
	}

	function getMessageVideoPlaylists(message: Message) {
		return message.data ? getVideoPlaylistArtifacts(message.data) : [];
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

							{#if getMessageTextBlocks(message).length > 0}
								<div class="mt-3 space-y-2">
									{#each getMessageTextBlocks(message) as artifact}
										<p class="text-xs leading-relaxed whitespace-pre-wrap text-foreground/80">
											{artifact.text}
										</p>
									{/each}
								</div>
							{/if}

							{#if getMessageTable(message)?.rows.length}
								<div class="mt-3 overflow-x-auto">
									<table class="w-full text-xs border-collapse">
										<thead>
											<tr class="border-b border-current/10">
												{#each getMessageTable(message)?.columns ?? [] as column}
													<th class="px-2 py-1.5 text-left font-medium opacity-70">{column}</th>
												{/each}
											</tr>
										</thead>
										<tbody>
											{#each getMessageTable(message)?.rows ?? [] as row}
												<tr class="border-b border-current/5 last:border-0">
													{#each getMessageTable(message)?.columns ?? [] as column}
														<td class="px-2 py-1.5">{row[column] ?? '—'}</td>
													{/each}
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}

							{#if getMessageSupportingTables(message).length > 0}
								<div class="mt-3 space-y-3">
									{#each getMessageSupportingTables(message) as tableArtifact, index}
										<div class="overflow-x-auto">
											<p class="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/60">
												Supporting Table {index + 1}
											</p>
											<table class="w-full text-xs border-collapse">
												<thead>
													<tr class="border-b border-current/10">
														{#each tableArtifact.columns as column}
															<th class="px-2 py-1.5 text-left font-medium opacity-70">{column}</th>
														{/each}
													</tr>
												</thead>
												<tbody>
													{#each tableArtifact.rows as row}
														<tr class="border-b border-current/5 last:border-0">
															{#each tableArtifact.columns as column}
																<td class="px-2 py-1.5">{row[column] ?? '—'}</td>
															{/each}
														</tr>
													{/each}
												</tbody>
											</table>
										</div>
									{/each}
								</div>
							{/if}

							{#if getMessageChartPlaceholders(message).length > 0}
								<div class="mt-3 space-y-3">
									{#each getMessageChartPlaceholders(message) as chart}
										<div class="rounded-lg border border-current/10 bg-card px-3 py-2.5">
											{#if chart.artifact.type === 'line_chart'}
												<LineChart artifact={chart.artifact} />
											{:else if chart.artifact.type === 'bar_chart'}
												<BarChart artifact={chart.artifact} />
											{:else if chart.artifact.type === 'shot_chart'}
												<ShotChart artifact={chart.artifact} />
											{/if}
										</div>
									{/each}
								</div>
							{/if}

							{#if getMessageVideoPlaylists(message).length > 0}
								<div class="mt-3 space-y-3">
									{#each getMessageVideoPlaylists(message) as playlist}
										<div class="rounded-lg border border-current/10 bg-card px-3 py-2.5">
											<VideoPlaylist artifact={playlist} />
										</div>
									{/each}
								</div>
							{/if}

							{#if getMessageWarnings(message).length > 0}
								<div class="mt-3 space-y-1">
									{#each getMessageWarnings(message) as warning}
										<p class="text-xs leading-relaxed text-amber-700/90 dark:text-amber-300/90">
											{warning}
										</p>
									{/each}
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
