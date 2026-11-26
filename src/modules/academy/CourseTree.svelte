<script lang="ts">
  import { academyStore } from './academyStore.svelte';

  let { onSelectUnit }: { onSelectUnit?: () => void } = $props();

  let query = $state('');
  let addingTarget = $state<{ kind: 'subject' } | { kind: 'chapter'; subjectId: string } | { kind: 'unit'; subjectId: string; chapterId: string } | null>(null);
  let draftTitle = $state('');
  let collapsed = $state<Record<string, boolean>>({});

  function toggle(key: string) {
    collapsed = { ...collapsed, [key]: !collapsed[key] };
  }

  function startAdd(target: NonNullable<typeof addingTarget>) {
    addingTarget = target;
    draftTitle = '';
  }

  async function submitAdd(event: SubmitEvent) {
    event.preventDefault();
    if (!addingTarget || !draftTitle.trim()) return;
    if (addingTarget.kind === 'subject') {
      await academyStore.createSubject(draftTitle);
    } else if (addingTarget.kind === 'chapter') {
      await academyStore.createChapter(addingTarget.subjectId, draftTitle);
    } else {
      await academyStore.createUnit(addingTarget.subjectId, addingTarget.chapterId, draftTitle);
      onSelectUnit?.();
    }
    addingTarget = null;
    draftTitle = '';
  }

  function matchesQuery(title: string) {
    const q = query.trim().toLocaleLowerCase('vi');
    return !q || title.toLocaleLowerCase('vi').includes(q);
  }
</script>

<div class="course-tree">
  <div class="tree-toolbar">
    <input
      class="search-input"
      type="search"
      placeholder="Tìm môn, chương, bài…"
      aria-label="Tìm môn, chương, bài"
      bind:value={query}
    />
    <button
      class="mini-plus"
      type="button"
      title="Thêm môn học"
      aria-label="Thêm môn học"
      onclick={() => startAdd({ kind: 'subject' })}
    >＋</button>
  </div>

  {#if addingTarget?.kind === 'subject'}
    <form class="inline-create" onsubmit={submitAdd}>
      <input
        class="inline-input"
        type="text"
        placeholder="Tên môn mới (VD: Hóa lý)"
        bind:value={draftTitle}
      />
      <button class="inline-save" type="submit">Tạo</button>
      <button class="inline-cancel" type="button" onclick={() => (addingTarget = null)}>×</button>
    </form>
  {/if}

  <div class="tree-list">
    {#each academyStore.subjects as subject (subject.id)}
      {@const chapters = academyStore.chaptersBySubject[subject.id] ?? []}
      {@const subjectCollapsed = Boolean(collapsed[`s:${subject.id}`])}
      <div class="tree-group">
        <div class="tree-row tree-row-subject">
          <button class="tree-toggle" type="button" onclick={() => toggle(`s:${subject.id}`)}>
            <span class="caret">{subjectCollapsed ? '▸' : '▾'}</span>
            <span class="row-title">{subject.title}</span>
          </button>
          <button
            class="mini-plus"
            type="button"
            title="Thêm chương vào {subject.title}"
            aria-label="Thêm chương"
            onclick={() => startAdd({ kind: 'chapter', subjectId: subject.id })}
          >＋</button>
        </div>

        {#if addingTarget?.kind === 'chapter' && addingTarget.subjectId === subject.id}
          <form class="inline-create indent-1" onsubmit={submitAdd}>
            <input class="inline-input" type="text" placeholder="Tên chương mới…" bind:value={draftTitle} />
            <button class="inline-save" type="submit">Tạo</button>
            <button class="inline-cancel" type="button" onclick={() => (addingTarget = null)}>×</button>
          </form>
        {/if}

        {#if !subjectCollapsed}
          {#each chapters as chapter (chapter.id)}
            {@const units = academyStore.unitsByChapter[academyStore.chapterKey(subject.id, chapter.id)] ?? []}
            {@const chapterKey = `c:${subject.id}/${chapter.id}`}
            {@const chapterCollapsed = Boolean(collapsed[chapterKey])}
            <div class="tree-chapter">
              <div class="tree-row tree-row-chapter">
                <button class="tree-toggle" type="button" onclick={() => toggle(chapterKey)}>
                  <span class="caret">{chapterCollapsed ? '▸' : '▾'}</span>
                  <span class="row-title">{chapter.title}</span>
                </button>
                <button
                  class="mini-plus"
                  type="button"
                  title="Thêm bài học vào {chapter.title}"
                  aria-label="Thêm bài học"
                  onclick={() => startAdd({ kind: 'unit', subjectId: subject.id, chapterId: chapter.id })}
                >＋</button>
              </div>

              {#if addingTarget?.kind === 'unit' && addingTarget.subjectId === subject.id && addingTarget.chapterId === chapter.id}
                <form class="inline-create indent-2" onsubmit={submitAdd}>
                  <input class="inline-input" type="text" placeholder="Tên bài học mới…" bind:value={draftTitle} />
                  <button class="inline-save" type="submit">Tạo</button>
                  <button class="inline-cancel" type="button" onclick={() => (addingTarget = null)}>×</button>
                </form>
              {/if}

              {#if !chapterCollapsed}
                {#each units.filter((u) => matchesQuery(u.title)) as unit (unit.id)}
                  <button
                    type="button"
                    class="tree-unit"
                    class:selected={academyStore.activeUnitId === unit.id && academyStore.activeChapterId === chapter.id}
                    onclick={async () => {
                      await academyStore.selectPath(subject.id, chapter.id, unit.id);
                      onSelectUnit?.();
                    }}
                  >
                    <span class="unit-dot" aria-hidden="true"></span>
                    <span class="row-title">{unit.title}</span>
                  </button>
                {/each}
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {/each}
  </div>

  <div class="tree-footer">
    <button
      class="tree-import-btn"
      type="button"
      onclick={() => {
        academyStore.importModalOpen = true;
        onSelectUnit?.();
      }}
    >
      ⇩ Nạp JSON (Môn / Chương / Tab)
    </button>
  </div>
</div>

<style>
  .course-tree {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tree-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tree-toolbar .search-input {
    flex: 1;
    margin: 0;
  }
  .mini-plus {
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--accent-solid);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    transition: background 0.15s ease;
  }
  .mini-plus:hover {
    background: var(--surface-hover);
  }
  .tree-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tree-row {
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: 12px;
    padding: 4px 4px 4px 6px;
  }
  .tree-row:hover {
    background: var(--surface-hover);
  }
  .tree-row-subject {
    font-weight: 600;
    color: var(--text-primary);
  }
  .tree-row-chapter {
    margin-left: 10px;
    font-size: 0.92rem;
    color: var(--text-secondary);
  }
  .tree-toggle {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    padding: 4px 2px;
  }
  .caret {
    font-size: 0.78rem;
    color: var(--text-muted);
    width: 12px;
  }
  .row-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tree-unit {
    width: calc(100% - 22px);
    margin-left: 22px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.9rem;
    text-align: left;
    padding: 7px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .tree-unit:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .tree-unit.selected {
    background: var(--surface-elevated);
    color: var(--accent-solid);
    font-weight: 600;
  }
  .unit-dot {
    width: 6px;
    height: 6px;
    border-radius: 99px;
    background: currentColor;
    opacity: 0.55;
    flex-shrink: 0;
  }
  .inline-create {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: var(--surface-elevated);
  }
  .indent-1 { margin-left: 10px; }
  .indent-2 { margin-left: 22px; }
  .inline-input {
    flex: 1;
    min-width: 0;
    border: 0;
    border-radius: 8px;
    background: #fff;
    padding: 6px 8px;
    font: inherit;
    font-size: 0.88rem;
  }
  .inline-save, .inline-cancel {
    border: 0;
    border-radius: 8px;
    padding: 4px 10px;
    font: inherit;
    font-size: 0.84rem;
    cursor: pointer;
  }
  .inline-save {
    background: var(--accent-solid);
    color: #fff;
  }
  .inline-cancel {
    background: transparent;
    color: var(--text-muted);
  }
  .tree-footer {
    margin-top: 6px;
    padding-top: 8px;
  }
  .tree-import-btn {
    width: 100%;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 500;
    padding: 9px 14px;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .tree-import-btn:hover {
    background: var(--surface-hover);
  }
</style>
