<script lang="ts">
  import { afterUpdate, tick } from "svelte";
  import { runQuery, type NLQResponse } from "./lib/api";
  import MessageTable, { type TableColumn } from "./lib/components/MessageTable.svelte";

  const examples = [
    "What is Scottie Barnes' mid-range FG% this season?",
    "Every pull-up three by Steph Curry vs drop coverage",
    "Compare Scottie Barnes vs Pascal Siakam mid-range efficiency in the playoffs",
    "All clutch isolation buckets by Jimmy Butler in the playoffs",
  ];

  type Message = {
    role: "user" | "assistant";
    text?: string;
    response?: NLQResponse;
    error?: string;
  };

  let headerEl: HTMLElement;
  let threadEl: HTMLDivElement;
  let composerEl: HTMLDivElement;
  let headerOffset = 0;
  let threadOffset = 0;
  let composerOffset = 0;
  let docked = false;
  let suppressTransition = false;
  let lastMessageCount = 0;

  let query = "";
  let loading = false;
  let messages: Message[] = [];
  let openClips = new Set<string>();

  function formatValue(value: string | number | undefined) {
    if (typeof value === "number") {
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
    }
    return value ?? "-";
  }

  function buildStatsTable(response: NLQResponse) {
    const stats = response.stats;
    if (!stats) return null;

    const hasEntity = stats.columns.includes("entity_name") || stats.columns.includes("entity_id");
    const hasValue = stats.columns.includes("value");
    const hasStat = stats.columns.includes("stat") || stats.columns.includes("stat_id");

    if (hasEntity && hasValue) {
      const columns: TableColumn[] = [
        { key: "rank", label: "#" },
        { key: "entity", label: response.intent === "comparison" ? "Entity" : "Player" },
      ];
      if (hasStat) columns.push({ key: "stat", label: "Stat" });
      columns.push({
        key: "value",
        label: "Value",
        align: "right",
      });

      const rows = stats.rows.map((row, index) => ({
        rank: index + 1,
        entity: String(row.entity_name ?? row.entity_id ?? "-"),
        stat: String((row.stat ?? row.stat_id ?? "").toString().replace(/^.*:/, "")),
        value: formatValue(row.value as string | number | undefined),
      }));

      return { columns, rows };
    }

    return {
      columns: stats.columns,
      rows: stats.rows,
    };
  }

  function tableColumns(response: NLQResponse) {
    return buildStatsTable(response)?.columns ?? [];
  }

  function tableRows(response: NLQResponse) {
    return buildStatsTable(response)?.rows ?? [];
  }

  async function submit() {
    if (!query.trim()) return;
    const userText = query.trim();
    messages = [...messages, { role: "user", text: userText }];
    query = "";
    loading = true;

    try {
      const response = await runQuery(userText);
      messages = [...messages, { role: "assistant", response }];
    } catch (err) {
      messages = [
        ...messages,
        {
          role: "assistant",
          error: err instanceof Error ? err.message : "Failed to run query",
        },
      ];
    } finally {
      loading = false;
    }
  }

  function toggleClip(key: string) {
    if (openClips.has(key)) openClips.delete(key);
    else openClips.add(key);
    // force reactivity
    openClips = new Set(openClips);
  }

  async function animatePageToDocked() {
    await tick();
    if (!headerEl || !threadEl || !composerEl || docked) return;
    const headerFirstTop = headerEl.getBoundingClientRect().top;
    const threadFirstTop = threadEl.getBoundingClientRect().top;
    const composerFirstTop = composerEl.getBoundingClientRect().top;

    docked = true;
    await tick();

    const headerLastTop = headerEl.getBoundingClientRect().top;
    const threadLastTop = threadEl.getBoundingClientRect().top;
    const composerLastTop = composerEl.getBoundingClientRect().top;
    const headerDelta = headerFirstTop - headerLastTop;
    const threadDelta = threadFirstTop - threadLastTop;
    const composerDelta = composerFirstTop - composerLastTop;

    suppressTransition = true;
    headerOffset = headerDelta;
    threadOffset = threadDelta;
    composerOffset = composerDelta;
    await tick();

    headerEl.getBoundingClientRect();
    threadEl.getBoundingClientRect();
    composerEl.getBoundingClientRect();

    suppressTransition = false;
    await tick();
    requestAnimationFrame(() => {
      headerOffset = 0;
      threadOffset = 0;
      composerOffset = 0;
    });
  }

  afterUpdate(() => {
    if (!docked && messages.length > 0 && lastMessageCount === 0) {
      animatePageToDocked();
    }
    lastMessageCount = messages.length;
  });
</script>

<svelte:head>
  <title>Hoop Hub</title>
</svelte:head>

<main class="page" class:docked={docked} class:landing={!docked}>
  <header
    class="top"
    class:no-transition={suppressTransition}
    bind:this={headerEl}
    style={`transform: translate3d(0, ${headerOffset}px, 0);`}
  >
    <p class="eyebrow">NBA Natural‑Language Engine</p>
    <h1>Ask any basketball question.</h1>
    <p class="lead">
      Hoop Hub translates natural language into authoritative NBA.com stats and the video evidence that
      supports them.
    </p>
  </header>

  <section class="chat" class:docked={docked}>
    <div
      class="thread"
      class:no-transition={suppressTransition}
      bind:this={threadEl}
      style={`transform: translate3d(0, ${threadOffset}px, 0);`}
    >
      {#if messages.length === 0}
        <div class="message assistant intro">
          <div class="intro-card">
            <p class="intro-title">Start with a question.</p>
            <p class="intro-body">
              Ask about players, shots, or games. We’ll translate it into stats and evidence.
            </p>
          </div>
        </div>
      {:else}
        {#each messages as message}
          <div class={`message ${message.role}`}>
            {#if message.role === "user"}
              <p>{message.text}</p>
            {:else if message.error}
              <div class="error">{message.error}</div>
            {:else if message.response}
              {#if message.response.answer}
                <div class="answer">{message.response.answer}</div>
              {/if}

              {#if !message.response.answer && (!message.response.stats || message.response.stats.rows.length === 0) && !message.response.clips}
                <div class="note">{message.response.explanation}</div>
              {/if}

              {#if message.response.stats && message.response.showTable !== false}
                <div class="card">
                  <h3>Stats</h3>
                  <MessageTable
                    columns={tableColumns(message.response)}
                    rows={tableRows(message.response)}
                    emptyText="No stats returned for this query."
                    dense
                  />
                </div>
              {/if}

              {#if message.response.clips}
                <div class="card">
                  <h3>Clips</h3>
                  <p class="muted">
                    Coverage: {message.response.clips.coverage.available} /
                    {message.response.clips.coverage.requested}
                  </p>
                  {#if message.response.clips.compiledUrl}
                    <video controls class="video" src={message.response.clips.compiledUrl}>
                      <track kind="captions" />
                    </video>
                  {/if}
                  <div class="clip-list">
                    {#each message.response.clips.items as clip}
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
                </div>
              {/if}
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    <div
      class="composer"
      class:no-transition={suppressTransition}
      bind:this={composerEl}
      style={`transform: translate3d(0, ${composerOffset}px, 0);`}
    >
      <div class="input-row">
        <input
          id="query"
          class="input"
          placeholder="What is Steph Curry's pull-up three FG% since 2022?"
          bind:value={query}
          on:keydown={(event) => event.key === "Enter" && submit()}
        />
        <button class="cta" on:click={submit} disabled={loading} aria-label="Send">
          {#if loading}
            Running…
          {:else}
            <svg class="send-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M3.6 11.1 20 4.5a.6.6 0 0 1 .8.7l-3.2 13.6a.6.6 0 0 1-1 .3l-5.1-4.2-3.1 3.4a.6.6 0 0 1-1-.4l.2-4.8-4-1.8a.6.6 0 0 1 0-1.2Z"
                fill="currentColor"
              />
            </svg>
          {/if}
        </button>
      </div>
      <div class="chips" class:collapsed={messages.length > 0}>
        {#each examples as example}
          <button class="chip" type="button" on:click={() => (query = example)}>
            {example}
          </button>
        {/each}
      </div>
    </div>
  </section>
</main>
