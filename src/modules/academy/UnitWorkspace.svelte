<script lang="ts">
  import { academyStore, TAB_PRESETS } from './academyStore.svelte';
  import { renderSafeMarkdown } from './markdownRenderer';
  import { getCachedVault, isAllowedDriveUrl } from '../../core/secretsVault';
  import { Block } from '../../domain/content/schemas';
  import { loadModule } from '../../core/moduleRegistry.js';
  import { toGooglePreviewUrl } from '../lessonViewer/lessonViewer.js';
  import type { Tab, TabType } from '../../domain/content/schemas';
  import type { ValidationIssue } from '../../domain/content/validation';
  import { z } from 'zod';

  let blocksHost = $state<HTMLDivElement | null>(null);
  let markdownHost = $state<HTMLElement | null>(null);

  // "+ Tab" popover state
  let addTabOpen = $state(false);
  let newTabPreset = $state(0);
  let newTabTitle = $state('');
  let newTabDriveUrl = $state('');

  // Inline editor state
  let editing = $state(false);
  let editTitle = $state('');
  let editBody = $state('');
  let editError = $state<string | null>(null);

  // Google Drive link editor state for `file` tabs
  let driveNameDraft = $state('');
  let driveUrlDraft = $state('');
  let driveError = $state<string | null>(null);

  // JSON Import modal state
  let importText = $state('');
  let importIssues = $state<ValidationIssue[]>([]);
  let importStatus = $state<string | null>(null);

  const unit = $derived(academyStore.activeUnit);
  const tab = $derived(academyStore.activeTab);
  const tabs = $derived(academyStore.activeTabs);
  const personalDriveFolder = $derived(getCachedVault().driveFolderUrl ?? '');

  function openEdit(current: Tab) {
    editing = true;
    editError = null;
    editTitle = current.title;
    editBody = current.format === 'markdown'
      ? (current.markdown ?? '')
      : JSON.stringify(current.blocks ?? [], null, 2);
  }

  async function saveEdit() {
    if (!tab) return;
    editError = null;
    try {
      if (tab.format === 'markdown') {
        await academyStore.saveActiveTab({ title: editTitle.trim() || tab.title, markdown: editBody });
      } else if (tab.format === 'blocks') {
        const parsed = JSON.parse(editBody);
        const blocks = z.array(Block).parse(parsed);
        await academyStore.saveActiveTab({ title: editTitle.trim() || tab.title, blocks });
      }
      editing = false;
    } catch (error) {
      editError = (error as Error).message;
    }
  }

  async function handleCreateTab(event: SubmitEvent) {
    event.preventDefault();
    const preset = TAB_PRESETS[newTabPreset] ?? TAB_PRESETS[0]!;
    if (preset.format === 'file' && newTabDriveUrl.trim() && !isAllowedDriveUrl(newTabDriveUrl.trim())) {
      driveError = 'Chỉ chấp nhận liên kết https://drive.google.com hoặc https://docs.google.com.';
      return;
    }
    driveError = null;
    await academyStore.createTab({
      title: newTabTitle.trim() || preset.defaultTitle,
      type: preset.type as TabType,
      format: preset.format,
      driveUrl: newTabDriveUrl.trim() || undefined,
    });
    addTabOpen = false;
    newTabTitle = '';
    newTabDriveUrl = '';
  }

  async function handleSaveDriveLink(event: SubmitEvent) {
    event.preventDefault();
    driveError = null;
    const url = driveUrlDraft.trim();
    if (url && !isAllowedDriveUrl(url)) {
      driveError = 'Chỉ chấp nhận liên kết https://drive.google.com hoặc https://docs.google.com.';
      return;
    }
    await academyStore.updateActiveTabDriveLink(driveNameDraft, url);
  }

  async function handleExportUnit() {
    try {
      const json = await academyStore.exportActiveUnitJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${unit?.id ?? 'theolab-unit'}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      importStatus = (error as Error).message;
    }
  }

  async function handleImportSubmit() {
    importIssues = [];
    importStatus = null;
    const result = await academyStore.importJsonText(importText);
    if (!result.ok) {
      importIssues = result.issues;
      return;
    }
    const s = result.summary;
    const parts = [
      s.subjects && `${s.subjects} môn`,
      s.chapters && `${s.chapters} chương`,
      s.units && `${s.units} bài`,
      s.tabs && `${s.tabs} tab`,
      s.questions && `${s.questions} câu hỏi`,
      s.datasets && `${s.datasets} bảng dữ liệu`,
      s.concepts && `${s.concepts} khái niệm`,
    ].filter(Boolean);
    importStatus = `Đã nạp: ${parts.join(', ') || '0 mục'}.`;
    importText = '';
    academyStore.importModalOpen = false;
  }

  async function handleJsonFilePick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    importText = await file.text();
    input.value = '';
  }

  // Render `blocks` tabs via the existing lessonViewer (KaTeX, widgets, MCQ, numeric tolerance).
  $effect(() => {
    const currentTab = tab;
    const currentUnit = unit;
    const host = blocksHost;
    if (!host || !currentTab || !currentUnit || currentTab.format !== 'blocks' || editing) return;

    let cancelled = false;
    (async () => {
      const viewer = await loadModule('lessonViewer') as {
        renderLesson: (lesson: unknown, el: HTMLElement) => Promise<void>;
        disposeLessonResources: (el: HTMLElement) => Promise<void>;
      };
      if (cancelled) return;
      await viewer.renderLesson({
        id: `${currentUnit.id}:${currentTab.id}`,
        core: { subject: academyStore.activeSubject?.title ?? '' },
        payload: {
          title: currentTab.title,
          reference_data: currentUnit.reference_data,
          blocks: currentTab.blocks ?? [],
        },
      }, host);
    })();

    return () => {
      cancelled = true;
      loadModule('lessonViewer')
        .then((v) => (v as { disposeLessonResources: (el: HTMLElement) => Promise<void> }).disposeLessonResources(host))
        .catch(() => {});
    };
  });

  // Render `markdown` tabs safely via DOM nodes + KaTeX.
  $effect(() => {
    const currentTab = tab;
    const host = markdownHost;
    if (!host || !currentTab || currentTab.format !== 'markdown' || editing) return;
    renderSafeMarkdown(host, currentTab.markdown ?? '');
  });

  // Sync Google Drive link inputs when opening a `file` tab.
  $effect(() => {
    const currentTab = tab;
    if (!currentTab || currentTab.format !== 'file') return;
    driveNameDraft = currentTab.file?.name ?? currentTab.title;
    driveUrlDraft = currentTab.file?.drive_url ?? '';
    driveError = null;
  });
</script>

<div class="academy-workspace">
  {#if academyStore.loading}
    <p class="status-line">Đang tải cấu trúc môn học…</p>
  {:else if !unit}
    <div class="empty-card">
      <h2>Chưa có bài học nào được chọn</h2>
      <p>Mở thanh bên trái để tạo Môn ▸ Chương ▸ Bài học mới, hoặc nạp một tệp JSON.</p>
      <button class="pill-btn primary" type="button" onclick={() => (academyStore.importModalOpen = true)}>
        ⇩ Nạp JSON
      </button>
    </div>
  {:else}
    <header class="unit-header">
      <div class="breadcrumb">
        <span>{academyStore.activeSubject?.title}</span>
        <span class="sep">›</span>
        <span>{academyStore.activeChapter?.title}</span>
      </div>
      <div class="unit-title-row">
        <h1 class="unit-title">{unit.title}</h1>
        <div class="unit-actions">
          <button class="pill-btn" type="button" onclick={() => (academyStore.importModalOpen = true)}>⇩ Nạp JSON</button>
          <button class="pill-btn" type="button" onclick={handleExportUnit}>⇧ Xuất JSON</button>
        </div>
      </div>
    </header>

    <!-- Tab bar with '+' button directly attached to the tabs -->
    <div class="unit-tabbar" role="tablist" aria-label="Các phần trong bài học">
      {#each tabs as item (item.id)}
        <button
          role="tab"
          type="button"
          class="unit-tab"
          class:active={tab?.id === item.id}
          aria-selected={tab?.id === item.id}
          onclick={() => {
            editing = false;
            academyStore.selectTab(item.id);
          }}
        >
          <span>{item.title}</span>
          <span class="tab-badge">{item.format === 'blocks' ? 'B' : item.format === 'file' ? 'F' : 'M'}</span>
        </button>
      {/each}

      <div class="add-tab-wrap">
        <button
          class="add-tab-btn"
          type="button"
          title="Thêm tab tài liệu mới cho bài này"
          aria-expanded={addTabOpen}
          onclick={() => (addTabOpen = !addTabOpen)}
        >＋</button>

        {#if addTabOpen}
          <form class="add-tab-popover" onsubmit={handleCreateTab}>
            <div class="popover-title">Thêm tab mới</div>
            <label class="field">
              <span>Loại tab</span>
              <select bind:value={newTabPreset}>
                {#each TAB_PRESETS as preset, idx (preset.type)}
                  <option value={idx}>{preset.label}</option>
                {/each}
              </select>
            </label>
            <label class="field">
              <span>Tiêu đề</span>
              <input
                type="text"
                placeholder={TAB_PRESETS[newTabPreset]?.defaultTitle ?? 'Tiêu đề tab'}
                bind:value={newTabTitle}
              />
            </label>
            {#if TAB_PRESETS[newTabPreset]?.format === 'file'}
              <label class="field">
                <span>Liên kết Google Drive (tùy chọn)</span>
                <input
                  type="url"
                  placeholder="https://drive.google.com/file/d/…"
                  bind:value={newTabDriveUrl}
                />
              </label>
            {/if}
            {#if driveError}
              <p class="error-banner">{driveError}</p>
            {/if}
            <div class="popover-actions">
              <button class="pill-btn" type="button" onclick={() => (addTabOpen = false)}>Hủy</button>
              <button class="pill-btn primary" type="submit">Tạo tab</button>
            </div>
          </form>
        {/if}
      </div>
    </div>

    {#if tab}
      <div class="tab-controls">
        <span class="tab-meta">
          Định dạng: <strong>{tab.format}</strong> · id: <code>{tab.id}</code>
        </span>
        <div class="tab-control-actions">
          {#if tab.format !== 'file'}
            {#if editing}
              <button class="pill-btn" type="button" onclick={() => (editing = false)}>Hủy</button>
              <button class="pill-btn primary" type="button" onclick={saveEdit}>Lưu thay đổi</button>
            {:else}
              <button class="pill-btn" type="button" onclick={() => openEdit(tab)}>✎ Chỉnh sửa</button>
            {/if}
          {/if}
          {#if tabs.length > 1}
            <button class="pill-btn danger" type="button" onclick={() => academyStore.deleteActiveTab()}>Xóa tab</button>
          {/if}
        </div>
      </div>

      {#if editing}
        <div class="tab-editor">
          <label class="field">
            <span>Tiêu đề tab</span>
            <input type="text" bind:value={editTitle} />
          </label>
          <label class="field">
            <span>{tab.format === 'markdown' ? 'Nội dung Markdown + LaTeX ($...$, $$...$$)' : 'Mảng Blocks JSON (kiểm tra Zod khi lưu)'}</span>
            <textarea rows="14" bind:value={editBody} spellcheck="false"></textarea>
          </label>
          {#if editError}
            <p class="error-banner">{editError}</p>
          {/if}
        </div>
      {:else if tab.format === 'blocks'}
        <div class="blocks-host" bind:this={blocksHost}></div>
      {:else if tab.format === 'markdown'}
        <article class="markdown-card" bind:this={markdownHost}></article>
      {:else if tab.format === 'file'}
        <div class="file-card">
          <div class="unit-title-row">
            <h3 style="margin:0">{tab.file?.name ?? tab.title}</h3>
            <div class="file-actions">
              {#if personalDriveFolder}
                <a class="pill-btn" href={personalDriveFolder} target="_blank" rel="noopener noreferrer">
                  ↗ Mở thư mục Drive cá nhân
                </a>
              {/if}
              {#if tab.file?.drive_url}
                <a class="pill-btn primary" href={tab.file.drive_url} target="_blank" rel="noopener noreferrer">
                  Mở trên Google Drive
                </a>
              {/if}
            </div>
          </div>

          {#if tab.file?.drive_url}
            <iframe
              class="drive-preview-frame"
              title={tab.file.name}
              src={toGooglePreviewUrl(tab.file.drive_url)}
              loading="lazy"
            ></iframe>
          {:else}
            <p class="tab-meta">
              Tệp được lưu trong Google Drive cá nhân của bạn. Tải tệp lên Drive rồi dán đường dẫn chia sẻ vào bên dưới để xem trực tiếp.
            </p>
          {/if}

          <form class="drive-form" onsubmit={handleSaveDriveLink}>
            <label class="field">
              <span>Tên tài liệu</span>
              <input type="text" bind:value={driveNameDraft} placeholder="Tên hiển thị…" />
            </label>
            <label class="field">
              <span>Đường dẫn Google Drive / Docs</span>
              <input
                type="url"
                bind:value={driveUrlDraft}
                placeholder="https://drive.google.com/file/d/…/view"
              />
            </label>
            {#if driveError}
              <p class="error-banner">{driveError}</p>
            {/if}
            <div class="popover-actions">
              <button class="pill-btn primary" type="submit">Lưu liên kết Drive</button>
            </div>
          </form>
        </div>
      {/if}
    {/if}
  {/if}

  {#if academyStore.importModalOpen}
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Nạp JSON vào TheoLab">
      <div class="modal-card">
        <div class="modal-head">
          <h2>Nạp JSON (v2 Bundle hoặc tài liệu đơn)</h2>
          <button class="pill-btn" type="button" onclick={() => (academyStore.importModalOpen = false)}>×</button>
        </div>
        <p class="modal-desc">
          Dán JSON có <code>"format": "theolab-bundle"</code> hoặc 1 tài liệu có <code>"kind"</code> (<code>subject</code>, <code>chapter</code>, <code>unit</code>, <code>tab</code>, <code>question</code>, <code>dataset</code>, <code>concept</code>).
        </p>
        <div class="modal-file-row">
          <label class="pill-btn file-upload-label">
            Chọn tệp .json
            <input type="file" accept=".json,application/json" hidden onchange={handleJsonFilePick} />
          </label>
        </div>
        <textarea
          class="import-textarea"
          rows="10"
          placeholder={'{"kind":"tab","id":"vi-du","subject_id":"hoa-phan-tich","chapter_id":"c03-can-bang-axit-bazo","unit_id":"acid-base-titration-weak-acid","title":"Ví dụ","type":"examples","format":"markdown","markdown":"## Ví dụ 1"}'}
          bind:value={importText}
          spellcheck="false"
        ></textarea>
        {#if importIssues.length}
          <ul class="error-list">
            {#each importIssues as issue, i (i)}
              <li><code>{issue.path}</code>: {issue.message}</li>
            {/each}
          </ul>
        {/if}
        {#if importStatus}
          <p class="status-line">{importStatus}</p>
        {/if}
        <div class="popover-actions">
          <button class="pill-btn" type="button" onclick={() => (academyStore.importModalOpen = false)}>Đóng</button>
          <button class="pill-btn primary" type="button" disabled={!importText.trim()} onclick={handleImportSubmit}>
            Kiểm tra & Nạp vào DB
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .academy-workspace {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .unit-header {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.86rem;
    color: var(--text-muted);
  }
  .unit-title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .unit-title {
    margin: 0;
    font-size: 1.55rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .unit-actions, .tab-control-actions, .file-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .unit-tabbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px;
    border-radius: var(--radius-card);
    background: var(--surface-card);
  }
  .unit-tab {
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.9rem;
    padding: 8px 14px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .unit-tab:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .unit-tab.active {
    background: #fff;
    color: var(--accent-solid);
    font-weight: 600;
    box-shadow: var(--shadow-float);
  }
  .tab-badge {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--text-muted);
  }
  .add-tab-wrap {
    position: relative;
  }
  .add-tab-btn {
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--accent-solid);
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .add-tab-btn:hover {
    background: var(--surface-hover);
  }
  .add-tab-popover {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 40;
    width: 280px;
    padding: 16px;
    border-radius: var(--radius-card);
    background: #fff;
    box-shadow: var(--shadow-float);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .popover-title {
    font-weight: 600;
    color: var(--text-primary);
  }
  .tab-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .tab-meta {
    font-size: 0.84rem;
    color: var(--text-muted);
  }
  .pill-btn {
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.86rem;
    font-weight: 500;
    padding: 7px 14px;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .pill-btn:hover { background: var(--surface-hover); }
  .pill-btn.primary { background: var(--accent-solid); color: #fff; }
  .pill-btn.danger { color: var(--error); }
  .pill-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .markdown-card, .file-card, .tab-editor, .empty-card {
    padding: 22px 24px;
    border-radius: var(--radius-card);
    background: var(--surface-card);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.86rem;
    color: var(--text-secondary);
  }
  .field input, .field select, .field textarea, .import-textarea {
    border: 0;
    border-radius: 12px;
    background: #fff;
    padding: 10px 12px;
    font: inherit;
    color: var(--text-primary);
  }
  .field textarea, .import-textarea {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.88rem;
    resize: vertical;
  }
  .error-banner, .error-list {
    margin: 0;
    padding: 10px 14px;
    border-radius: 12px;
    background: #fce8e6;
    color: var(--error);
    font-size: 0.86rem;
  }
  .error-list { padding-left: 26px; }
  .popover-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgb(15 23 42 / 35%);
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .modal-card {
    width: min(640px, 100%);
    padding: 22px;
    border-radius: var(--radius-card);
    background: var(--surface-card);
    box-shadow: var(--shadow-float);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .modal-head h2 { margin: 0; font-size: 1.15rem; }
  .modal-desc { margin: 0; font-size: 0.88rem; color: var(--text-secondary); }
  .file-upload-label { cursor: pointer; }
  .drive-preview-frame {
    width: 100%;
    height: 460px;
    border: 0;
    border-radius: 14px;
    background: #fff;
  }
  .drive-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  :global(.md-math-block) { margin: 10px 0; overflow-x: auto; }
  :global(.md-code-block) {
    background: #fff;
    padding: 12px 14px;
    border-radius: 12px;
    overflow-x: auto;
    font-size: 0.86rem;
  }
  :global(.md-inline-code) {
    background: var(--surface-elevated);
    padding: 1px 6px;
    border-radius: 6px;
    font-size: 0.88em;
  }
  :global(.md-quote) {
    margin: 6px 0;
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--surface-elevated);
    color: var(--text-secondary);
  }
  :global(.md-list) { margin: 4px 0; padding-left: 20px; }
  :global(.md-paragraph) { margin: 4px 0; line-height: 1.65; }
</style>
