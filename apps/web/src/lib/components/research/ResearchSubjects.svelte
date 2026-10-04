<script lang="ts">
	import EntityAvatar from '$lib/components/entities/EntityAvatar.svelte';
	import type { QueryAnswerResponse } from '$lib/contracts/answer-response';
	import { researchSubjects } from '$lib/presentation/research-subjects';
	let { result }: { result: QueryAnswerResponse } = $props();
	const subjects = $derived(researchSubjects(result));
</script>

{#if subjects.players.length || subjects.teams.length}
	<div class="research-subjects" aria-label="Research subjects">
		{#if subjects.players.length}
			<div class="player-subjects" class:matchup={subjects.matchup}>
				{#each subjects.players as player, index (player.id)}
					{#if subjects.matchup && index === 1}<span class="versus" aria-hidden="true">vs.</span>{/if}
					<div class="subject"><EntityAvatar entity={player.entity} fallbackName={player.name} size={48} /><div class="subject-name">{#if player.role}<span class="subject-role">{player.role}</span>{/if}<span>{player.name}</span></div></div>
				{/each}
			</div>
		{/if}
		{#if subjects.teams.length}
			<div class="team-subjects">{#each subjects.teams as team (team.id)}<div class="subject"><EntityAvatar entity={team.entity} fallbackName={team.name} size={28} /><span>{team.role === 'Opponent' ? 'vs. ' : ''}{team.name}</span></div>{/each}</div>
		{/if}
	</div>
{/if}

<style>
	.research-subjects { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; }
	.player-subjects, .team-subjects { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; min-width: 0; }
	.subject { display: flex; align-items: center; gap: 10px; min-width: 0; max-width: 100%; }
	.subject-name { display: grid; gap: 3px; font-size: 13px; font-weight: 500; line-height: 1.5; overflow-wrap: anywhere; min-width: 0; }
	.subject-role, .versus { font-size: 11px; color: var(--color-muted-foreground); font-weight: 400; }
	.team-subjects { font-size: 12px; color: var(--color-muted-foreground); }
	.team-subjects .subject > span { min-width: 0; overflow-wrap: anywhere; }
	.matchup { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); width: 100%; max-width: 620px; gap: 16px; }
	@container (max-width: 440px) { .matchup { gap: 8px; } .matchup .subject { flex-direction: column; align-items: flex-start; gap: 8px; } }
</style>
