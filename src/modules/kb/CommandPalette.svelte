<script lang="ts">
  import { onMount } from 'svelte';
  import { searchKnowledgeBase, type KbSearchResult } from './kbService';

  let { onNavigate }: { onNavigate?: (deepLink: string) => void } = $props();

  let open = $state(false);
  let query = $state('');
  let hits = $state<KbSearchResult[]>([]);
  let mode = $state<'hybrid' | 'bm25'>('bm25');
  let selectedIndex = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let timer: number | undefined;

  export function show() {
    open = true;
    selectedIndex = 0;
    queueMicrotask(() => inputEl?.focus());
  }

  function close() {
    open = false;
  }

  function pick(hit: KbSearchResult) {
    close();
    onNavigate?.(hit.deep_link);
  }

  function onInput() {
    window.clearTimeout(timer);
    const q = query;
    if (!q.trim()) {
      hits = [];
      return;
    }
    timer = window.setTimeout(async () => {
      const res = await searchKnowledgeBase(q, { k: 8 });
      if (query === q) {
        hits = res.hits;
        mode = res.mode;
        selectedIndex = 0;
      }
    }, 180);
  }

  function onKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (open) close();
      else show();
      return;
    }
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' && hits.length) {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % hits.length;
    } else if (event.key === 'ArrowUp' && hits.length) {
      event.preventDefault();
      selectedIndex = (selectedIndex - 1 + hits.length) % hits.length;
    } else if (event.key === 'Enter' && hits[selectedIndex]) {
      event.preventDefault();
      pick(hits[selectedIndex]!);
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown);
    const openListener = () => show();
    window.addEventListener('theolab:open-palette', openListener);
    return () => {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('theolab:open-palette', openListener);
      window.clearTimeout(timer);
    };
  });
</script>

{#if open}
  <div class="palette-backdrop" role="dialog" aria-modal="true" aria-label="Tìm kiếm nhanh kiến thức">
    <div class="palette-card">
      <div class="palette-input-row">
        <span class="palette-icon" aria-hidden="true">⌘</span>
        <input
          bind:this={inputEl}
          class="palette-input"
          type="search"
          placeholder="Tìm nhanh môn, chương, bài, công thức, khái niệm… (Esc để đóng)"
          bind:value={query}
          oninput={onInput}
        />
        <button class="palette-close" type="button" onclick={close}>Esc</button>
      </div>

      {#if hits.length}
        <div class="palette-meta">
          {mode === 'hybrid' ? 'Hybrid (Gemini Vector + BM25)' : 'BM25 tiếng Việt'} · {hits.length} kết quả
        </div>
        <div class="palette-results">
          {#each hits as hit, idx (hit.id)}
            <button
              type="button"
              class="palette-item"
              class:active={idx === selectedIndex}
              onmouseenter={() => (selectedIndex = idx)}
              onclick={() => pick(hit)}
            >
              <div class="palette-crumb">{hit.breadcrumb}</div>
              <div class="palette-snippet">{hit.snippet}</div>
            </button>
          {/each}
        </div>
      {:else if query.trim()}
        <p class="palette-empty">Không tìm thấy đoạn kiến thức phù hợp.</p>
      {:else}
        <p class="palette-empty">Gõ từ khóa hoặc câu hỏi (VD: "Henderson", "chuẩn độ axit yếu", "điểm tương đương")…</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .palette-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgb(15 23 42 / 35%);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 12vh 16px 16px;
  }
  .palette-card {
    width: min(640px, 100%);
    padding: 14px;
    border-radius: var(--radius-card);
    background: var(--surface-card);
    box-shadow: var(--shadow-float);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .palette-input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    border-radius: var(--radius-pill);
    background: #fff;
  }
  .palette-icon { color: var(--accent-solid); font-weight: 600; }
  .palette-input {
    flex: 1;
    border: 0;
    background: transparent;
    font: inherit;
    font-size: 0.96rem;
    outline: none;
  }
  .palette-close {
    border: 0;
    border-radius: 8px;
    background: var(--surface-elevated);
    color: var(--text-muted);
    font: inherit;
    font-size: 0.78rem;
    padding: 4px 8px;
    cursor: pointer;
  }
  .palette-meta {
    font-size: 0.78rem;
    color: var(--text-muted);
    padding: 0 6px;
  }
  .palette-results {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 52vh;
    overflow-y: auto;
  }
  .palette-item {
    border: 0;
    border-radius: 12px;
    background: #fff;
    padding: 10px 12px;
    text-align: left;
    font: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .palette-item.active, .palette-item:hover {
    background: var(--surface-hover);
  }
  .palette-crumb {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--accent-solid);
  }
  .palette-snippet {
    font-size: 0.86rem;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .palette-empty {
    margin: 6px;
    font-size: 0.86rem;
    color: var(--text-muted);
  }
</style>
