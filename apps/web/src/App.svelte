<script lang="ts">
  import { runQuery, type NLQResponse } from "./lib/api";

  const examples = [
    "What is Scottie Barnes' mid-range FG% this season?",
    "Every pull-up three by Steph Curry vs drop coverage",
    "Compare Scottie Barnes vs Pascal Siakam mid-range efficiency in the playoffs",
    "All clutch isolation buckets by Jimmy Butler in the playoffs",
  ];

  let query = "";
  let loading = false;
  let error: string | null = null;
  let response: NLQResponse | null = null;

  async function submit() {
    if (!query.trim()) return;
    loading = true;
    error = null;
    response = null;

    try {
      response = await runQuery(query.trim());
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to run query";
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Hoop Hub</title>
</svelte:head>

<main class="page">
  <section class="hero">
    <div class="hero-text">
      <p class="eyebrow">NBA Natural‑Language Engine</p>
      <h1>Ask any basketball question. Get the stats and the clips.</h1>
      <p class="lead">
        Hoop Hub translates natural language into authoritative NBA.com stats and the video evidence that
        supports them.
      </p>
    </div>
    <div class="hero-card">
      <label class="label" for="query">Your question</label>
      <div class="input-row">
        <input
          id="query"
          class="input"
          placeholder="What is Steph Curry's pull-up three FG% since 2022?"
          bind:value={query}
          on:keydown={(event) => event.key === "Enter" && submit()}
        />
        <button class="cta" on:click={submit} disabled={loading}>
          {loading ? "Running…" : "Run Query"}
        </button>
      </div>
      <div class="chips">
        {#each examples as example}
          <button class="chip" type="button" on:click={() => (query = example)}>
            {example}
          </button>
        {/each}
      </div>
    </div>
  </section>

  <section class="results">
    <div class="results-header">
      <h2>Results</h2>
      <p>Stats are sourced from NBA.com endpoints; clips are resolved per play.</p>
    </div>

    {#if error}
      <div class="error">{error}</div>
    {:else if !response}
      <div class="empty">Run a query to see answers, rankings, and clips.</div>
    {:else}
      <div class="summary">
        <p><strong>Intent:</strong> {response.intent}</p>
        <p><strong>Explanation:</strong> {response.explanation}</p>
      </div>

      {#if response.stats}
        <div class="card">
          <h3>Stats</h3>
          <div class="table">
            <div class="table-header">
              {#each response.stats.columns as col}
                <div>{col}</div>
              {/each}
            </div>
            {#each response.stats.rows as row}
              <div class="table-row">
                {#each response.stats.columns as col}
                  <div>{row[col]}</div>
                {/each}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if response.clips}
        <div class="card">
          <h3>Clips</h3>
          <p class="muted">
            Coverage: {response.clips.coverage.available} / {response.clips.coverage.requested}
          </p>
          {#if response.clips.compiledUrl}
            <video controls class="video" src={response.clips.compiledUrl}></video>
          {/if}
          <div class="clip-list">
            {#each response.clips.items as clip}
              <div class="clip-item">
                <div>
                  <strong>Game:</strong> {clip.gameId} <strong>Event:</strong> {clip.eventId}
                </div>
                {#if clip.videoAvailable && clip.url}
                  <a href={clip.url} target="_blank" rel="noreferrer">Open clip</a>
                {:else}
                  <span class="muted">Clip unavailable</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </section>
</main>
