<script lang="ts">
  import { onMount } from 'svelte';
  import {
    ensureKbLoaded,
    getKbStats,
    searchKnowledgeBase,
    syncAndIndexKb,
    type KbSearchResult,
    type KbStats,
    type SyncProgress,
  } from './kbService';

  let { onNavigate }: { onNavigate?: (deepLink: string) => void } = $props();

  let stats = $state<KbStats>(getKbStats());
  let syncing = $state(false);
  let progress = $state<SyncProgress | null>(null);
  let summaryNote = $state<string | null>(null);
  let errorNote = $state<string | null>(null);

  let query = $state('');
  let searching = $state(false);
  let searchMode = $state<'hybrid' | 'bm25'>('bm25');
  let hits = $state<KbSearchResult[]>([]);

  onMount(async () => {
    stats = await ensureKbLoaded();
  });

  async function handleSync() {
    syncing = true;
    errorNote = null;
    summaryNote = null;
    try {
      const result = await syncAndIndexKb({
        onProgress: (p) => { progress = p; },
      });
      stats = result.stats;
      summaryNote = result.stats.denseReady
        ? `Hoàn tất: tạo mới ${result.embeddedNow} vector, tái sử dụng ${result.reused}, dọn ${result.removed} đoạn cũ.`
        : `Đã cập nhật ${result.stats.totalChunks} đoạn cho tìm kiếm từ khóa BM25. Thêm Google AI Studio API Key trong Cấu hình → Cấu hình AI để bật Vector Embedding.`;
    } catch (error) {
      errorNote = (error as Error).message;
    } finally {
      syncing = false;
    }
  }

  async function handleSearch(event: SubmitEvent) {
    event.preventDefault();
    if (!query.trim()) {
      hits = [];
      return;
    }
    searching = true;
    errorNote = null;
    try {
      const res = await searchKnowledgeBase(query, { k: 8 });
      hits = res.hits;
      searchMode = res.mode;
    } catch (error) {
      errorNote = (error as Error).message;
    } finally {
      searching = false;
    }
  }
</script>

<div class="kb-panel">
  <header class="kb-head">
    <div>
      <h1 class="page-title">Kho Vector & Embedding</h1>
      <p class="page-subtitle">
        Tìm kiếm kết hợp ngữ nghĩa (Gemini Embedding 2 · lượng tử hóa int8) và từ khóa BM25 tiếng Việt ngay trong Web Worker.
      </p>
    </div>
    <button class="pill-btn primary" type="button" disabled={syncing} onclick={handleSync}>
      {syncing ? 'Đang đánh chỉ mục…' : '⚡ Đánh chỉ mục & đồng bộ'}
    </button>
  </header>

  <section class="stats-grid">
    <div class="stat-card">
      <span class="stat-label">Tổng đoạn kiến thức</span>
      <strong class="stat-value">{stats.totalChunks}</strong>
    </div>
    <div class="stat-card">
      <span class="stat-label">Đã có Vector int8</span>
      <strong class="stat-value">{stats.embeddedChunks}</strong>
    </div>
    <div class="stat-card">
      <span class="stat-label">Chế độ truy xuất</span>
      <strong class="stat-value">{stats.denseReady ? 'Hybrid (Vector + BM25)' : 'BM25 (Từ khóa)'}</strong>
    </div>
    <div class="stat-card">
      <span class="stat-label">Model · Số chiều</span>
      <strong class="stat-value">{stats.model} · {stats.dims}d</strong>
    </div>
  </section>

  {#if progress && syncing}
    <div class="info-banner">{progress.message}</div>
  {/if}
  {#if summaryNote}
    <div class="info-banner">{summaryNote}</div>
  {/if}
  {#if errorNote}
    <div class="error-banner">{errorNote}</div>
  {/if}

  <section class="search-card">
    <h2>Thử truy vấn kho kiến thức (hoặc nhấn Ctrl+K bất cứ lúc nào)</h2>
    <form class="search-form" onsubmit={handleSearch}>
      <input
        class="search-field"
        type="search"
        placeholder="VD: vùng đệm Henderson, chuẩn độ H3PO4, EDTA pH=11…"
        bind:value={query}
      />
      <button class="pill-btn primary" type="submit" disabled={searching}>
        {searching ? 'Đang tìm…' : 'Tìm kiếm'}
      </button>
    </form>

    {#if hits.length}
      <p class="mode-note">Chế độ: <strong>{searchMode === 'hybrid' ? 'Hybrid (Gemini Vector + BM25 + RRF)' : 'BM25 tiếng Việt'}</strong> · {hits.length} kết quả</p>
      <div class="hit-list">
        {#each hits as hit (hit.id)}
          <button
            type="button"
            class="hit-item"
            onclick={() => onNavigate?.(hit.deep_link)}
          >
            <div class="hit-top">
              <span class="hit-crumb">{hit.breadcrumb}</span>
              <span class="hit-scores">
                {#if hit.dense !== undefined}vec {hit.dense.toFixed(2)}{/if}
                {#if hit.lexical !== undefined} · bm25 {hit.lexical.toFixed(2)}{/if}
              </span>
            </div>
            <p class="hit-snippet">{hit.snippet}</p>
          </button>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .kb-panel {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .kb-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 12px;
  }
  .stat-card {
    padding: 16px 18px;
    border-radius: var(--radius-card);
    background: var(--surface-card);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .stat-label {
    font-size: 0.82rem;
    color: var(--text-muted);
  }
  .stat-value {
    font-size: 1.05rem;
    color: var(--text-primary);
  }
  .search-card {
    padding: 20px 22px;
    border-radius: var(--radius-card);
    background: var(--surface-card);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .search-card h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .search-form {
    display: flex;
    gap: 8px;
  }
  .search-field {
    flex: 1;
    border: 0;
    border-radius: var(--radius-pill);
    background: #fff;
    padding: 10px 16px;
    font: inherit;
  }
  .pill-btn {
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 500;
    padding: 9px 16px;
    cursor: pointer;
  }
  .pill-btn.primary {
    background: var(--accent-solid);
    color: #fff;
  }
  .pill-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .info-banner, .error-banner {
    padding: 12px 16px;
    border-radius: 14px;
    font-size: 0.88rem;
  }
  .info-banner { background: var(--surface-elevated); color: var(--text-primary); }
  .error-banner { background: #fce8e6; color: var(--error); }
  .mode-note { margin: 0; font-size: 0.84rem; color: var(--text-muted); }
  .hit-list { display: flex; flex-direction: column; gap: 8px; }
  .hit-item {
    border: 0;
    border-radius: 14px;
    background: #fff;
    padding: 12px 14px;
    text-align: left;
    font: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 4px;
    transition: background 0.15s ease;
  }
  .hit-item:hover { background: var(--surface-hover); }
  .hit-top {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 0.82rem;
    color: var(--accent-solid);
    font-weight: 600;
  }
  .hit-scores { color: var(--text-muted); font-weight: 500; white-space: nowrap; }
  .hit-snippet { margin: 0; font-size: 0.88rem; color: var(--text-secondary); line-height: 1.5; }
</style>
