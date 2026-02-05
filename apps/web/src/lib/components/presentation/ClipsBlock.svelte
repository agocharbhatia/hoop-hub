<script lang="ts">
  import type { PresentationClipsBlock } from "../../api";

  export let block: PresentationClipsBlock;

  const COLLAPSED_CLIP_COUNT = 8;

  let openClips = new Set<string>();
  let expanded = false;

  function toggleClip(key: string) {
    if (openClips.has(key)) openClips.delete(key);
    else openClips.add(key);
    openClips = new Set(openClips);
  }

  $: clipCount = block.items.length;
  $: isTruncated = clipCount > COLLAPSED_CLIP_COUNT;
  $: visibleItems = expanded || !isTruncated ? block.items : block.items.slice(0, COLLAPSED_CLIP_COUNT);
</script>

<section class="viz-card">
  <div class="header">
    <h3>{block.title ?? "Clips"}</h3>
    <p class="muted">
      Coverage: {block.coverage.available} / {block.coverage.requested}
    </p>
  </div>

  {#if block.compiledUrl}
    <video controls class="video" src={block.compiledUrl}>
      <track kind="captions" />
    </video>
  {/if}

  <div class="clip-list">
    {#each visibleItems as clip}
      <div class="clip-item">
        <div class="clip-meta">
          <div>
            <strong>Game:</strong> {clip.gameId} <strong>Event:</strong> {clip.eventId}
          </div>
          {#if clip.videoAvailable && clip.url}
            <div class="clip-actions">
              <button class="link" type="button" on:click={() => toggleClip(`${clip.gameId}:${clip.eventId}`)}>
                {openClips.has(`${clip.gameId}:${clip.eventId}`) ? "Hide" : "Play"}
              </button>
              <a href={clip.url} target="_blank" rel="noreferrer">Open</a>
            </div>
          {:else}
            <span class="muted">Clip unavailable</span>
          {/if}
        </div>

        {#if clip.videoAvailable && clip.url && openClips.has(`${clip.gameId}:${clip.eventId}`)}
          <video class="video inline" controls preload="metadata" src={clip.url}>
            <track kind="captions" />
          </video>
        {/if}
      </div>
    {/each}
  </div>

  {#if isTruncated}
    <div class="controls">
      <p class="hint">
        {#if expanded}
          Showing all clips.
        {:else}
          Showing first {COLLAPSED_CLIP_COUNT} clips.
        {/if}
      </p>
      <button type="button" class="toggle" on:click={() => (expanded = !expanded)}>
        {expanded ? "Collapse list" : `Expand list (${clipCount - COLLAPSED_CLIP_COUNT} more)`}
      </button>
    </div>
  {/if}
</section>

<style>
  .viz-card {
    background: var(--panel);
    border-radius: 16px;
    border: 1px solid rgba(68, 96, 116, 0.3);
    padding: 16px;
    display: grid;
    gap: 12px;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  h3 {
    margin: 0;
    color: var(--text);
    font-size: 0.96rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .muted {
    margin: 0;
    color: var(--text);
    opacity: 0.75;
  }

  .video {
    width: 100%;
    border-radius: 12px;
    margin-top: 4px;
  }

  .clip-list {
    display: grid;
    gap: 10px;
    max-height: 440px;
    overflow-y: auto;
    padding-right: 2px;
  }

  .clip-item {
    display: grid;
    gap: 10px;
    background: rgba(59, 84, 101, 0.14);
    padding: 10px 12px;
    border-radius: 10px;
  }

  .clip-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .clip-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .link {
    background: transparent;
    border: none;
    color: var(--accent-2);
    font: inherit;
    cursor: pointer;
    padding: 0;
  }

  .video.inline {
    margin-top: 0;
  }

  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .toggle {
    border: 1px solid rgba(68, 96, 116, 0.4);
    background: rgba(59, 84, 101, 0.18);
    color: var(--text);
    border-radius: 10px;
    padding: 8px 12px;
    font: inherit;
    cursor: pointer;
  }

  .toggle:hover {
    background: rgba(68, 96, 116, 0.26);
  }

  @media (max-width: 640px) {
    .header {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
