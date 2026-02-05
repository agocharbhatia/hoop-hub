<script lang="ts">
  import type { PresentationKpiBlock } from "../../api";

  export let block: PresentationKpiBlock;
</script>

<div class="kpi-card">
  <p class="label">{block.label}</p>
  <p class="value">{block.value}</p>
  {#if block.subtitle}
    <p class="subtitle">{block.subtitle}</p>
  {/if}
</div>

<style>
  .kpi-card {
    background: rgba(59, 84, 101, 0.2);
    border: 1px solid rgba(68, 96, 116, 0.28);
    border-radius: 14px;
    padding: 16px;
    display: grid;
    gap: 4px;
  }

  .label {
    margin: 0;
    color: var(--muted);
    font-size: 0.82rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .value {
    margin: 0;
    color: var(--text);
    font-size: clamp(1.45rem, 2.6vw, 2rem);
    font-weight: 700;
    line-height: 1.1;
  }

  .subtitle {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
</style>
