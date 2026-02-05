<script lang="ts">
  import type { PresentationTextBlock } from "../../api";

  export let block: PresentationTextBlock;
</script>

<div class={`text-block ${block.tone === "answer" ? "answer" : "note"}`}>
  <p>{block.text}</p>
</div>

<style>
  .text-block {
    border-radius: 14px;
    padding: 12px 14px;
    border: 1px solid rgba(68, 96, 116, 0.24);
  }

  .text-block.answer {
    background: rgba(59, 84, 101, 0.2);
    color: var(--text);
  }

  .text-block.note {
    background: rgba(34, 48, 58, 0.65);
    color: var(--muted);
  }

  p {
    margin: 0;
    line-height: 1.45;
  }
</style>
