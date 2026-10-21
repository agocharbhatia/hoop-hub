<script lang="ts">
	import { IconDownload, IconPhoto, IconPin } from '@tabler/icons-svelte';
	import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
	import type { ArtifactExportContext } from '$lib/presentation/artifact-export';
	import { downloadArtifactCsv, downloadArtifactPng } from '$lib/presentation/artifact-export';
	import PinArtifactDialog from './PinArtifactDialog.svelte';
	let { artifact, context = {}, sessionId, turnId, artifactIndex, disabled = false }: { artifact: QueryAnswerArtifact; context?: ArtifactExportContext; sessionId?: string; turnId?: string; artifactIndex: number; disabled?: boolean } = $props();
	let pinOpen = $state(false), exporting = $state(false), error = $state('');
	async function png() { if (exporting) return; exporting = true; error = ''; try { await downloadArtifactPng(artifact, context); } catch (cause) { error = cause instanceof Error ? cause.message : 'Image export could not finish.'; } finally { exporting = false; } }
	function csv() { error = ''; try { downloadArtifactCsv(artifact, context); } catch { error = 'Data export could not finish.'; } }
</script>

<div class="artifact-actions" aria-label="Finding actions"><button type="button" onclick={() => void png()} disabled={exporting || disabled} aria-label="Export finding as PNG"><IconPhoto size={13} />{exporting ? 'Preparing…' : 'Image'}</button><button type="button" onclick={csv} {disabled} aria-label="Export finding as CSV"><IconDownload size={13} />CSV</button>{#if sessionId && turnId}<button type="button" onclick={() => pinOpen = true} {disabled} aria-label="Pin finding to a board"><IconPin size={13} />Pin</button>{/if}</div>
{#if error}<p class="action-error" role="status">{error}</p>{/if}
{#if sessionId && turnId}<PinArtifactDialog open={pinOpen} {sessionId} {turnId} {artifactIndex} view={context.view} question={context.question} onclose={() => pinOpen = false} />{/if}

<style>
	.artifact-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; } button { display: inline-flex; gap: 6px; align-items: center; color: var(--color-muted-foreground); padding: 7px 9px; border-radius: 5px; font-size: 12px; cursor: pointer; } button:hover { background: #ffffff06; color: var(--color-foreground); } button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; } button:disabled { opacity: .5; cursor: default; } .action-error { color: var(--color-warning); font-size: 13px; line-height: 1.6; padding: 7px 0; }
@media (max-width: 850px) { button { min-height: 44px; } }
</style>
