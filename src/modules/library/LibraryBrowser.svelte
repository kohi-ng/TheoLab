<script lang="ts">
  import { onMount } from 'svelte';
  import { getCachedVault } from '../../core/secretsVault';
  import { canOpenLibraryItemInDock } from '../apps/mountApps';
  import { libraryStore } from './libraryStore.svelte';
  import {
    BUILTIN_FOLDER_SENTINEL,
    UNFILED_FOLDER_SENTINEL,
    buildFolderTree,
    collectAllTags,
    flattenFolderTree,
    foldVietnamese,
    getFolderPathLabel,
    getKindIcon,
    getKindLabel,
    getSourceLabel,
    groupLibraryItems,
    normalizeTags,
    queryLibraryItems,
  } from '../../domain/library/query';
  import {
    LIBRARY_ITEM_KINDS,
    type AiLibrarySuggestionBatch,
    type LibraryFolder,
    type LibraryGroupMode,
    type LibraryItemKind,
    type LibraryItemSource,
    type LibraryItemView,
    type LibrarySortField,
  } from '../../domain/library/schemas';

  let {
    mode = 'full',
    onOpenItem,
    onOpenInDock,
    onAttachToChat,
    onToast,
  }: {
    mode?: 'full' | 'drawer';
    onOpenItem: (item: LibraryItemView) => void;
    onOpenInDock?: (item: LibraryItemView) => void;
    onAttachToChat?: (item: LibraryItemView) => void;
    onToast?: (message: string) => void;
  } = $props();

  // Filter & search state
  let searchQuery = $state('');
  let folderFilter = $state<string>('all');
  let kindFilter = $state<LibraryItemKind | 'all'>('all');
  let sourceFilter = $state<LibraryItemSource | 'all'>('all');
  let tagFilter = $state<string>('all');
  let mobileSidebarOpen = $state(false);

  // Quick add link form state
  let showAddLink = $state(false);
  let addTitle = $state('');
  let addUrl = $state('');
  let addFolderId = $state<string>('');
  let addTagsRaw = $state('');
  let addDescription = $state('');
  let addingItem = $state(false);

  // Folder management state
  let showNewFolderForm = $state(false);
  let newFolderName = $state('');
  let newFolderParentId = $state<string>('');

  // Multi-select & bulk operations state
  let selectedIds = $state<Record<string, boolean>>({});
  let bulkMoveTarget = $state<string>('');
  let bulkTagInput = $state('');
  let showBulkRename = $state(false);
  let bulkRenameDrafts = $state<Record<string, string>>({});

  // Context menu & single-item edit modal state
  let menuItemId = $state<string | null>(null);
  let editingItem = $state<LibraryItemView | null>(null);
  let editTitle = $state('');
  let editTags = $state('');
  let editFolderId = $state<string>('');
  let editDescription = $state('');

  // Drag-and-drop state
  let draggingItemId = $state<string | null>(null);
  let dragOverFolderKey = $state<string | null>(null);

  // Optional AI metadata-only categorization suggestions
  let aiSuggesting = $state(false);
  let aiSuggestions = $state<
    Array<AiLibrarySuggestionBatch['suggestions'][number] & { accepted: boolean; itemTitle: string }>
  >([]);

  const prefs = $derived(libraryStore.viewPrefs);
  const allItems = $derived(libraryStore.allItems);
  const folders = $derived(libraryStore.folders);
  const flatFolders = $derived(flattenFolderTree(buildFolderTree(folders)));
  const allTags = $derived(collectAllTags(allItems));
  const driveFolderUrl = $derived(getCachedVault().driveFolderUrl ?? '');

  const visibleItems = $derived(
    queryLibraryItems(allItems, folders, {
      query: searchQuery,
      kind: kindFilter,
      source: sourceFilter,
      tag: tagFilter,
      folderFilter,
      includeSubfolders: true,
      sortBy: prefs.sortBy,
      sortDir: prefs.sortDir,
    }),
  );

  const groupedItems = $derived(
    groupLibraryItems(visibleItems, folders, mode === 'drawer' ? 'folder' : prefs.groupBy),
  );

  const selectedMutableIds = $derived(
    Object.entries(selectedIds)
      .filter(([, checked]) => checked)
      .map(([id]) => id)
      .filter((id) => libraryStore.userItems.some((item) => item.id === id)),
  );

  const allVisibleMutableIds = $derived(
    visibleItems.filter((item) => item.source !== 'builtin').map((item) => item.id),
  );

  onMount(() => {
    libraryStore.load();
  });

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  }

  function folderItemCount(folderId: string): number {
    return queryLibraryItems(allItems, folders, {
      folderFilter: folderId,
      includeSubfolders: true,
    }).length;
  }

  function isDockable(item: LibraryItemView): boolean {
    return canOpenLibraryItemInDock({
      id: item.id,
      title: item.title,
      type: item.type ?? item.kind,
      kind: item.kind,
      url: item.url,
      file: item.file,
      mimeType: item.mimeType,
      sourceLabel: item.sourceLabel,
      widget: item.widget,
    });
  }

  function toggleSortColumn(field: LibrarySortField) {
    if (prefs.sortBy === field) {
      libraryStore.setViewPrefs({ sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' });
    } else {
      libraryStore.setViewPrefs({
        sortBy: field,
        sortDir: field === 'createdAt' ? 'desc' : 'asc',
      });
    }
  }

  function toggleSelectItem(id: string, checked: boolean) {
    selectedIds = { ...selectedIds, [id]: checked };
  }

  function toggleSelectAllVisible() {
    const allSelected =
      allVisibleMutableIds.length > 0 && allVisibleMutableIds.every((id) => selectedIds[id]);
    const next = { ...selectedIds };
    for (const id of allVisibleMutableIds) {
      next[id] = !allSelected;
    }
    selectedIds = next;
  }

  function clearSelection() {
    selectedIds = {};
    showBulkRename = false;
  }

  async function handleAddDriveLink(event: SubmitEvent) {
    event.preventDefault();
    if (addingItem) return;
    addingItem = true;
    try {
      const tags = normalizeTags(addTagsRaw.split(','));
      const created = await libraryStore.createItem({
        title: addTitle,
        url: addUrl,
        source: 'drive',
        folderId: addFolderId || null,
        tags,
        description: addDescription,
      });
      addTitle = '';
      addUrl = '';
      addTagsRaw = '';
      addDescription = '';
      showAddLink = false;
      onToast?.(`Đã thêm "${created.title}" vào Thư viện.`);
      onOpenItem(created);
    } catch (error) {
      onToast?.((error as Error).message);
    } finally {
      addingItem = false;
    }
  }

  async function handleCreateFolder(event: SubmitEvent) {
    event.preventDefault();
    try {
      const created = await libraryStore.createFolder({
        name: newFolderName,
        parentId: newFolderParentId || null,
      });
      newFolderName = '';
      newFolderParentId = '';
      showNewFolderForm = false;
      folderFilter = created.id;
      onToast?.(`Đã tạo thư mục "${created.name}".`);
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  async function handleRenameFolder(folder: LibraryFolder) {
    const nextName = window.prompt('Đổi tên thư mục', folder.name);
    if (!nextName?.trim() || nextName.trim() === folder.name) return;
    try {
      await libraryStore.updateFolder(folder.id, { name: nextName.trim() });
      onToast?.(`Đã đổi tên thành "${nextName.trim()}".`);
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  async function handleDeleteFolder(folder: LibraryFolder) {
    if (!window.confirm(`Xóa thư mục "${folder.name}"? Các tài liệu bên trong sẽ được giữ lại ở thư mục cha.`)) {
      return;
    }
    try {
      await libraryStore.deleteFolder(folder.id);
      if (folderFilter === folder.id) folderFilter = 'all';
      onToast?.(`Đã xóa thư mục "${folder.name}".`);
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  function openEditDialog(item: LibraryItemView) {
    menuItemId = null;
    editingItem = item;
    editTitle = item.title;
    editTags = item.tags.join(', ');
    editFolderId = item.folderId ?? '';
    editDescription = item.description ?? '';
  }

  async function handleSaveEdit(event: SubmitEvent) {
    event.preventDefault();
    if (!editingItem) return;
    try {
      await libraryStore.updateItem(editingItem.id, {
        title: editTitle,
        tags: normalizeTags(editTags.split(',')),
        folderId: editFolderId || null,
        description: editDescription,
      });
      onToast?.(`Đã cập nhật "${editTitle.trim()}".`);
      editingItem = null;
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  async function handleDeleteItem(item: LibraryItemView) {
    menuItemId = null;
    if (!window.confirm(`Xóa "${item.title}" khỏi Thư viện?`)) return;
    try {
      await libraryStore.deleteItem(item.id);
      onToast?.(`Đã xóa "${item.title}".`);
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  async function handleBulkMove() {
    if (!selectedMutableIds.length) return;
    try {
      const target = bulkMoveTarget || null;
      const count = await libraryStore.bulkMove(selectedMutableIds, target);
      onToast?.(`Đã chuyển ${count} tài liệu.`);
      clearSelection();
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  async function handleBulkTag() {
    const tags = normalizeTags(bulkTagInput.split(','));
    if (!selectedMutableIds.length || !tags.length) return;
    try {
      const count = await libraryStore.bulkAddTags(selectedMutableIds, tags);
      bulkTagInput = '';
      onToast?.(`Đã gắn thẻ cho ${count} tài liệu.`);
      clearSelection();
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  function openBulkRenamePanel() {
    const drafts: Record<string, string> = {};
    for (const id of selectedMutableIds) {
      const item = libraryStore.userItems.find((i) => i.id === id);
      if (item) drafts[id] = item.title;
    }
    bulkRenameDrafts = drafts;
    showBulkRename = true;
  }

  async function handleApplyBulkRename(event: SubmitEvent) {
    event.preventDefault();
    try {
      let count = 0;
      for (const [id, title] of Object.entries(bulkRenameDrafts)) {
        const clean = title.trim();
        if (!clean) continue;
        await libraryStore.updateItem(id, { title: clean });
        count += 1;
      }
      onToast?.(`Đã đổi tên ${count} tài liệu.`);
      clearSelection();
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  async function handleBulkDelete() {
    if (!selectedMutableIds.length) return;
    if (!window.confirm(`Xóa ${selectedMutableIds.length} tài liệu đã chọn khỏi Thư viện?`)) return;
    try {
      await libraryStore.bulkDelete(selectedMutableIds);
      onToast?.(`Đã xóa ${selectedMutableIds.length} tài liệu.`);
      clearSelection();
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  // Drag-and-drop handlers
  function handleDragStart(event: DragEvent, item: LibraryItemView) {
    if (item.source === 'builtin') return;
    draggingItemId = item.id;
    event.dataTransfer?.setData('text/plain', item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOverFolder(event: DragEvent, key: string) {
    if (!draggingItemId) return;
    event.preventDefault();
    dragOverFolderKey = key;
  }

  async function handleDropOnFolder(event: DragEvent, targetFolderId: string | null) {
    event.preventDefault();
    const itemId = draggingItemId || event.dataTransfer?.getData('text/plain');
    draggingItemId = null;
    dragOverFolderKey = null;
    if (!itemId) return;
    const targetIds = selectedMutableIds.includes(itemId) ? selectedMutableIds : [itemId];
    try {
      const count = await libraryStore.bulkMove(targetIds, targetFolderId);
      onToast?.(`Đã chuyển ${count} tài liệu vào ${targetFolderId ? getFolderPathLabel(folders, targetFolderId) : 'Chưa phân thư mục'}.`);
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  async function handleAiSuggest() {
    aiSuggesting = true;
    aiSuggestions = [];
    try {
      const pool = selectedMutableIds.length
        ? libraryStore.userItems.filter((i) => selectedMutableIds.includes(i.id))
        : visibleItems.filter((i) => i.source !== 'builtin');
      const raw = await libraryStore.suggestCategorizationWithAi(pool);
      const titleById = new Map(pool.map((i) => [i.id, i.title]));
      aiSuggestions = raw.map((s) => ({
        ...s,
        accepted: true,
        itemTitle: titleById.get(s.itemId) ?? s.itemId,
      }));
      if (!aiSuggestions.length) {
        onToast?.('AI không có đề xuất mới cho các mục hiện tại.');
      }
    } catch (error) {
      onToast?.(`Không thể lấy gợi ý AI: ${(error as Error).message}`);
    } finally {
      aiSuggesting = false;
    }
  }

  async function handleApplyAiSuggestions() {
    const accepted = aiSuggestions.filter((s) => s.accepted);
    if (!accepted.length) {
      aiSuggestions = [];
      return;
    }
    try {
      const folderByFoldedName = new Map(
        libraryStore.folders.map((f) => [foldVietnamese(f.name), f]),
      );
      let applied = 0;
      for (const s of accepted) {
        let targetFolderId: string | null | undefined = undefined;
        if (s.folderName?.trim()) {
          const folded = foldVietnamese(s.folderName.trim());
          let folder = folderByFoldedName.get(folded);
          if (!folder) {
            folder = await libraryStore.createFolder({ name: s.folderName.trim() });
            folderByFoldedName.set(folded, folder);
          }
          targetFolderId = folder.id;
        }
        const current = libraryStore.userItems.find((i) => i.id === s.itemId);
        if (!current) continue;
        await libraryStore.updateItem(s.itemId, {
          ...(targetFolderId !== undefined ? { folderId: targetFolderId } : {}),
          tags: normalizeTags([...current.tags, ...s.tags]),
        });
        applied += 1;
      }
      aiSuggestions = [];
      onToast?.(`Đã áp dụng phân loại cho ${applied} tài liệu.`);
    } catch (error) {
      onToast?.(`Lỗi khi áp dụng gợi ý: ${(error as Error).message}`);
    }
  }

  function folderIndentClass(depth: number): string {
    if (depth <= 0) return 'depth-0';
    if (depth === 1) return 'depth-1';
    if (depth === 2) return 'depth-2';
    return 'depth-3';
  }
</script>

<!-- COMPACT DRAWER MODE -->
{#if mode === 'drawer'}
  <div class="lib-drawer">
    <input
      class="search-input drawer-search"
      type="search"
      placeholder="Tìm nhanh trong thư viện…"
      aria-label="Tìm tài liệu trong thư viện"
      bind:value={searchQuery}
    />

    <div class="drawer-actions">
      {#if driveFolderUrl}
        <a class="tree-item" href={driveFolderUrl} target="_blank" rel="noopener noreferrer">
          ↗ Mở thư mục Drive cá nhân
        </a>
      {/if}
      <button type="button" class="tree-item" onclick={() => (showAddLink = !showAddLink)}>
        {showAddLink ? '✕ Đóng form thêm link' : '＋ Thêm tài liệu Google Drive'}
      </button>
    </div>

    {#if showAddLink}
      <form class="drawer-add-form" onsubmit={handleAddDriveLink}>
        <input class="search-input compact-field" type="text" required placeholder="Tên tài liệu…" bind:value={addTitle} />
        <input class="search-input compact-field" type="url" required placeholder="https://drive.google.com/…" bind:value={addUrl} />
        {#if flatFolders.length > 0}
          <select class="select-input compact-field" bind:value={addFolderId} aria-label="Chọn thư mục">
            <option value="">Chưa phân thư mục</option>
            {#each flatFolders as node (node.folder.id)}
              <option value={node.folder.id}>{'— '.repeat(node.depth)}{node.folder.name}</option>
            {/each}
          </select>
        {/if}
        <button type="submit" class="pill-btn primary" disabled={addingItem}>
          {addingItem ? 'Đang lưu…' : 'Lưu vào Thư viện'}
        </button>
      </form>
    {/if}

    {#if flatFolders.length > 0}
      <select class="select-input compact-field" bind:value={folderFilter} aria-label="Lọc theo thư mục">
        <option value="all">Tất cả thư mục ({allItems.length})</option>
        <option value={UNFILED_FOLDER_SENTINEL}>Chưa phân thư mục</option>
        {#each flatFolders as node (node.folder.id)}
          <option value={node.folder.id}>{'— '.repeat(node.depth)}📁 {node.folder.name}</option>
        {/each}
        <option value={BUILTIN_FOLDER_SENTINEL}>Tài nguyên TheoLab (mặc định)</option>
      </select>
    {/if}

    <div class="drawer-groups">
      {#each groupedItems as group (group.key)}
        {#if group.label}
          <h2 class="drawer-section-title drawer-group-heading">{group.label}</h2>
        {/if}
        {#each group.items as item (item.id)}
          <div class="drawer-item-row">
            <button
              type="button"
              class="library-entry drawer-entry"
              class:selected={libraryStore.activeItemId === item.id}
              onclick={() => onOpenItem(item)}
            >
              <strong>{getKindIcon(item.kind, item.mimeType)} {item.title}</strong>
              <small>{getKindLabel(item.kind, item.mimeType)}{item.tags.length ? ` · #${item.tags.slice(0, 2).join(' #')}` : ''}</small>
            </button>
            {#if isDockable(item) && onOpenInDock}
              <button
                type="button"
                class="icon-button compact-icon-btn"
                title="Mở sang khung phải"
                aria-label={`Mở ${item.title} sang khung phải`}
                onclick={() => onOpenInDock?.(item)}
              >
                ◫
              </button>
            {/if}
          </div>
        {/each}
      {:else}
        <p class="status-line">Không có tài liệu phù hợp.</p>
      {/each}
    </div>
  </div>

<!-- FULL WORKSPACE MODE -->
{:else}
  <div class="lib-shell">
    <header class="lib-header">
      <div>
        <h1 class="page-title">Thư viện</h1>
        <p class="page-subtitle">
          Quản lý tài liệu cá nhân theo thư mục &amp; thẻ, mở trên canvas, chia đôi khung phải hoặc đính kèm vào Chat AI.
        </p>
      </div>
      <div class="header-actions">
        <button type="button" class="pill-btn mobile-only" onclick={() => (mobileSidebarOpen = !mobileSidebarOpen)}>
          {mobileSidebarOpen ? 'Ẩn thư mục' : '📁 Thư mục & Thẻ'}
        </button>
        <button
          type="button"
          class="pill-btn"
          disabled={aiSuggesting || libraryStore.userItems.length === 0}
          title="Chỉ gửi tiêu đề & loại file (không gửi nội dung) để AI gợi ý thư mục và thẻ"
          onclick={handleAiSuggest}
        >
          {aiSuggesting ? 'Đang gợi ý…' : '✦ AI gợi ý phân loại'}
        </button>
        <button type="button" class="pill-btn primary" onclick={() => (showAddLink = !showAddLink)}>
          {showAddLink ? 'Đóng form' : '＋ Thêm tài liệu Drive'}
        </button>
      </div>
    </header>

    {#if libraryStore.error}
      <div class="error-banner">{libraryStore.error}</div>
    {/if}

    {#if showAddLink}
      <form class="surface-panel add-form" onsubmit={handleAddDriveLink}>
        <strong>Thêm tài liệu Google Drive bằng liên kết</strong>
        <div class="form-grid">
          <label class="field-box">
            <span>Tên tài liệu</span>
            <input class="text-input white-field" type="text" required placeholder="VD: Đề thi Hóa phân tích 2026" bind:value={addTitle} />
          </label>
          <label class="field-box">
            <span>Liên kết Google Drive / Docs / Sheets / Slides</span>
            <input class="text-input white-field" type="url" required placeholder="https://drive.google.com/file/d/…" bind:value={addUrl} />
          </label>
          <label class="field-box">
            <span>Thư mục</span>
            <select class="select-input white-field" bind:value={addFolderId}>
              <option value="">Chưa phân thư mục</option>
              {#each flatFolders as node (node.folder.id)}
                <option value={node.folder.id}>{'— '.repeat(node.depth)}{node.folder.name}</option>
              {/each}
            </select>
          </label>
          <label class="field-box">
            <span>Thẻ (phân cách dấu phẩy)</span>
            <input class="text-input white-field" type="text" placeholder="hóa phân tích, chương 3, đề thi" bind:value={addTagsRaw} />
          </label>
        </div>
        <label class="field-box">
          <span>Ghi chú (tùy chọn)</span>
          <input class="text-input white-field" type="text" placeholder="Ghi chú ngắn gọn về tài liệu" bind:value={addDescription} />
        </label>
        <div class="row-actions">
          <button type="submit" class="pill-btn primary" disabled={addingItem}>
            {addingItem ? 'Đang lưu…' : 'Lưu vào Thư viện'}
          </button>
          <button type="button" class="pill-btn" onclick={() => (showAddLink = false)}>Hủy</button>
        </div>
      </form>
    {/if}

    <!-- AI Categorization Review Panel (user confirmation required) -->
    {#if aiSuggestions.length > 0}
      <section class="surface-panel ai-suggest-panel" aria-label="Đề xuất phân loại của AI">
        <div class="panel-head">
          <div>
            <strong>✦ Đề xuất phân loại từ AI (chưa áp dụng)</strong>
            <p class="status-line">AI chỉ đọc tiêu đề và loại tệp. Kiểm tra và chọn các đề xuất bạn muốn áp dụng.</p>
          </div>
          <div class="row-actions">
            <button type="button" class="pill-btn primary" onclick={handleApplyAiSuggestions}>
              Áp dụng đề xuất đã chọn
            </button>
            <button type="button" class="pill-btn" onclick={() => (aiSuggestions = [])}>Bỏ qua</button>
          </div>
        </div>
        <div class="suggest-list">
          {#each aiSuggestions as item, index (item.itemId)}
            <label class="suggest-row">
              <input
                type="checkbox"
                checked={item.accepted}
                onchange={(e) => {
                  aiSuggestions = aiSuggestions.map((entry, i) =>
                    i === index ? { ...entry, accepted: (e.currentTarget as HTMLInputElement).checked } : entry,
                  );
                }}
              />
              <span class="suggest-copy">
                <strong>{item.itemTitle}</strong>
                <small>
                  Thư mục: {item.folderName || '(giữ nguyên)'} · Thẻ: {item.tags.length ? item.tags.map((t) => `#${t}`).join(' ') : '(không thêm)'}
                </small>
              </span>
            </label>
          {/each}
        </div>
      </section>
    {/if}

    <div class="lib-layout">
      <!-- SIDEBAR: Folder Tree + Tags -->
      <aside class="lib-sidebar" class:mobile-open={mobileSidebarOpen} aria-label="Thư mục và thẻ thư viện">
        <div class="sidebar-block">
          <div class="sidebar-head">
            <span class="sidebar-title">Thư mục</span>
            <button
              type="button"
              class="mini-btn"
              title="Tạo thư mục mới"
              onclick={() => (showNewFolderForm = !showNewFolderForm)}
            >
              ＋
            </button>
          </div>

          {#if showNewFolderForm}
            <form class="folder-form" onsubmit={handleCreateFolder}>
              <input
                class="text-input white-field compact-field"
                type="text"
                required
                placeholder="Tên thư mục mới…"
                bind:value={newFolderName}
              />
              <select class="select-input white-field compact-field" bind:value={newFolderParentId} aria-label="Thư mục cha">
                <option value="">(Thư mục gốc)</option>
                {#each flatFolders as node (node.folder.id)}
                  <option value={node.folder.id}>{'— '.repeat(node.depth)}{node.folder.name}</option>
                {/each}
              </select>
              <div class="row-actions">
                <button type="submit" class="pill-btn primary mini-pill">Tạo</button>
                <button type="button" class="pill-btn mini-pill" onclick={() => (showNewFolderForm = false)}>Hủy</button>
              </div>
            </form>
          {/if}

          <button
            type="button"
            class="folder-btn"
            class:selected={folderFilter === 'all'}
            onclick={() => (folderFilter = 'all')}
          >
            <span>📚 Tất cả</span>
            <span class="count-pill">{allItems.length}</span>
          </button>

          <button
            type="button"
            class="folder-btn"
            class:selected={folderFilter === UNFILED_FOLDER_SENTINEL}
            class:drag-over={dragOverFolderKey === UNFILED_FOLDER_SENTINEL}
            ondragover={(e) => handleDragOverFolder(e, UNFILED_FOLDER_SENTINEL)}
            ondragleave={() => (dragOverFolderKey = null)}
            ondrop={(e) => handleDropOnFolder(e, null)}
            onclick={() => (folderFilter = UNFILED_FOLDER_SENTINEL)}
          >
            <span>📥 Chưa phân thư mục</span>
            <span class="count-pill">{folderItemCount(UNFILED_FOLDER_SENTINEL)}</span>
          </button>

          {#each flatFolders as node (node.folder.id)}
            <div
              class={`folder-row ${folderIndentClass(node.depth)}`}
              class:drag-over={dragOverFolderKey === node.folder.id}
              role="group"
              ondragover={(e) => handleDragOverFolder(e, node.folder.id)}
              ondragleave={() => (dragOverFolderKey = null)}
              ondrop={(e) => handleDropOnFolder(e, node.folder.id)}
            >
              <button
                type="button"
                class="folder-btn"
                class:selected={folderFilter === node.folder.id}
                onclick={() => (folderFilter = node.folder.id)}
              >
                <span class="folder-name">{node.folder.icon ?? '📁'} {node.folder.name}</span>
                <span class="count-pill">{folderItemCount(node.folder.id)}</span>
              </button>
              <button
                type="button"
                class="mini-btn"
                title="Đổi tên thư mục"
                aria-label={`Đổi tên thư mục ${node.folder.name}`}
                onclick={() => handleRenameFolder(node.folder)}
              >
                ✎
              </button>
              <button
                type="button"
                class="mini-btn danger-text"
                title="Xóa thư mục"
                aria-label={`Xóa thư mục ${node.folder.name}`}
                onclick={() => handleDeleteFolder(node.folder)}
              >
                ×
              </button>
            </div>
          {/each}

          <button
            type="button"
            class="folder-btn system-folder"
            class:selected={folderFilter === BUILTIN_FOLDER_SENTINEL}
            onclick={() => (folderFilter = BUILTIN_FOLDER_SENTINEL)}
          >
            <span>✦ TheoLab (mặc định)</span>
            <span class="count-pill">{libraryStore.builtinItems.length}</span>
          </button>
        </div>

        <div class="sidebar-block">
          <div class="sidebar-head">
            <span class="sidebar-title">Thẻ (Tags)</span>
            {#if tagFilter !== 'all'}
              <button type="button" class="mini-btn" onclick={() => (tagFilter = 'all')}>Bỏ lọc</button>
            {/if}
          </div>
          <div class="tag-cloud">
            {#each allTags as entry (entry.tag)}
              <button
                type="button"
                class="tag-pill"
                class:selected={tagFilter !== 'all' && foldVietnamese(tagFilter) === foldVietnamese(entry.tag)}
                onclick={() => (tagFilter = tagFilter === entry.tag ? 'all' : entry.tag)}
              >
                #{entry.tag} ({entry.count})
              </button>
            {:else}
              <p class="status-line">Chưa có thẻ nào.</p>
            {/each}
          </div>
        </div>
      </aside>

      <!-- MAIN BROWSER PANE -->
      <section class="lib-main">
        <!-- Toolbar -->
        <div class="toolbar-card">
          <input
            class="text-input white-field toolbar-search"
            type="search"
            placeholder="Tìm theo tên, thẻ, thư mục (hỗ trợ tiếng Việt không dấu)…"
            aria-label="Tìm kiếm trong thư viện"
            bind:value={searchQuery}
          />

          <div class="toolbar-controls">
            <select class="select-input white-field toolbar-select" bind:value={kindFilter} aria-label="Lọc theo loại">
              <option value="all">Mọi loại</option>
              {#each LIBRARY_ITEM_KINDS as k (k)}
                <option value={k}>{getKindLabel(k)}</option>
              {/each}
            </select>

            <select class="select-input white-field toolbar-select" bind:value={sourceFilter} aria-label="Lọc theo nguồn">
              <option value="all">Mọi nguồn</option>
              <option value="drive">Google Drive</option>
              <option value="builtin">TheoLab</option>
              <option value="upload">Tải lên</option>
            </select>

            <select
              class="select-input white-field toolbar-select"
              value={prefs.sortBy}
              aria-label="Sắp xếp theo"
              onchange={(e) =>
                libraryStore.setViewPrefs({ sortBy: (e.currentTarget as HTMLSelectElement).value as LibrarySortField })}
            >
              <option value="createdAt">Sắp xếp: Ngày thêm</option>
              <option value="title">Sắp xếp: Tên</option>
              <option value="kind">Sắp xếp: Loại</option>
            </select>

            <button
              type="button"
              class="pill-btn"
              title={prefs.sortDir === 'asc' ? 'Đang tăng dần' : 'Đang giảm dần'}
              onclick={() => libraryStore.setViewPrefs({ sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' })}
            >
              {prefs.sortDir === 'asc' ? '↑ Tăng' : '↓ Giảm'}
            </button>

            <select
              class="select-input white-field toolbar-select"
              value={prefs.groupBy}
              aria-label="Nhóm theo"
              onchange={(e) =>
                libraryStore.setViewPrefs({ groupBy: (e.currentTarget as HTMLSelectElement).value as LibraryGroupMode })}
            >
              <option value="none">Không nhóm</option>
              <option value="folder">Nhóm: Thư mục</option>
              <option value="kind">Nhóm: Loại</option>
              <option value="tag">Nhóm: Thẻ</option>
            </select>

            <div class="view-switch" role="group" aria-label="Chế độ xem">
              <button
                type="button"
                class="view-btn"
                class:active={prefs.viewMode === 'list'}
                onclick={() => libraryStore.setViewPrefs({ viewMode: 'list' })}
              >
                ☰ Danh sách
              </button>
              <button
                type="button"
                class="view-btn"
                class:active={prefs.viewMode === 'details'}
                onclick={() => libraryStore.setViewPrefs({ viewMode: 'details' })}
              >
                ▤ Chi tiết
              </button>
              <button
                type="button"
                class="view-btn"
                class:active={prefs.viewMode === 'grid'}
                onclick={() => libraryStore.setViewPrefs({ viewMode: 'grid' })}
              >
                ⊞ Lưới
              </button>
            </div>

            {#if prefs.viewMode === 'grid'}
              <div class="view-switch" role="group" aria-label="Kích cỡ biểu tượng">
                <button
                  type="button"
                  class="view-btn"
                  class:active={prefs.gridSize === 'sm'}
                  onclick={() => libraryStore.setViewPrefs({ gridSize: 'sm' })}
                >
                  Nhỏ
                </button>
                <button
                  type="button"
                  class="view-btn"
                  class:active={prefs.gridSize === 'md'}
                  onclick={() => libraryStore.setViewPrefs({ gridSize: 'md' })}
                >
                  Vừa
                </button>
                <button
                  type="button"
                  class="view-btn"
                  class:active={prefs.gridSize === 'lg'}
                  onclick={() => libraryStore.setViewPrefs({ gridSize: 'lg' })}
                >
                  Lớn
                </button>
              </div>
            {/if}
          </div>
        </div>

        <!-- Bulk Action Bar -->
        {#if selectedMutableIds.length > 0}
          <div class="bulk-bar" role="region" aria-label="Thao tác hàng loạt">
            <strong>Đã chọn {selectedMutableIds.length} mục</strong>
            <div class="bulk-controls">
              <select class="select-input white-field compact-field" bind:value={bulkMoveTarget} aria-label="Thư mục đích">
                <option value="">Chuyển tới: Chưa phân thư mục</option>
                {#each flatFolders as node (node.folder.id)}
                  <option value={node.folder.id}>{'— '.repeat(node.depth)}{node.folder.name}</option>
                {/each}
              </select>
              <button type="button" class="pill-btn" onclick={handleBulkMove}>Chuyển</button>

              <input
                class="text-input white-field compact-field bulk-tag-input"
                type="text"
                placeholder="Thêm tag (phẩy)…"
                bind:value={bulkTagInput}
              />
              <button type="button" class="pill-btn" onclick={handleBulkTag}>Gắn tag</button>

              <button type="button" class="pill-btn" onclick={openBulkRenamePanel}>Đổi tên</button>
              <button type="button" class="pill-btn danger-text" onclick={handleBulkDelete}>Xóa</button>
              <button type="button" class="pill-btn" onclick={clearSelection}>Bỏ chọn</button>
            </div>
          </div>
        {/if}

        <!-- Bulk Rename Panel -->
        {#if showBulkRename && selectedMutableIds.length > 0}
          <form class="surface-panel" onsubmit={handleApplyBulkRename}>
            <strong>Đổi tên hàng loạt ({selectedMutableIds.length} mục)</strong>
            <div class="bulk-rename-list">
              {#each selectedMutableIds as id (id)}
                <input
                  class="text-input white-field"
                  type="text"
                  required
                  value={bulkRenameDrafts[id] ?? ''}
                  oninput={(e) => {
                    bulkRenameDrafts = {
                      ...bulkRenameDrafts,
                      [id]: (e.currentTarget as HTMLInputElement).value,
                    };
                  }}
                />
              {/each}
            </div>
            <div class="row-actions">
              <button type="submit" class="pill-btn primary">Lưu tất cả tên mới</button>
              <button type="button" class="pill-btn" onclick={() => (showBulkRename = false)}>Hủy</button>
            </div>
          </form>
        {/if}

        <!-- Single Item Edit Panel -->
        {#if editingItem}
          <form class="surface-panel" onsubmit={handleSaveEdit}>
            <strong>Chỉnh sửa tài liệu</strong>
            <div class="form-grid">
              <label class="field-box">
                <span>Tên tài liệu</span>
                <input class="text-input white-field" type="text" required bind:value={editTitle} />
              </label>
              <label class="field-box">
                <span>Thư mục</span>
                <select class="select-input white-field" bind:value={editFolderId}>
                  <option value="">Chưa phân thư mục</option>
                  {#each flatFolders as node (node.folder.id)}
                    <option value={node.folder.id}>{'— '.repeat(node.depth)}{node.folder.name}</option>
                  {/each}
                </select>
              </label>
              <label class="field-box">
                <span>Thẻ (phân cách dấu phẩy)</span>
                <input class="text-input white-field" type="text" bind:value={editTags} />
              </label>
              <label class="field-box">
                <span>Ghi chú</span>
                <input class="text-input white-field" type="text" bind:value={editDescription} />
              </label>
            </div>
            <div class="row-actions">
              <button type="submit" class="pill-btn primary">Lưu thay đổi</button>
              <button type="button" class="pill-btn" onclick={() => (editingItem = null)}>Hủy</button>
            </div>
          </form>
        {/if}

        <!-- RESULTS -->
        {#if visibleItems.length === 0}
          <div class="empty-card">
            <p>Không tìm thấy tài liệu nào khớp điều kiện lọc.</p>
          </div>
        {:else}
          {#each groupedItems as group (group.key)}
            {#if group.label}
              <h2 class="group-heading">{group.label} ({group.items.length})</h2>
            {/if}

            <!-- VIEW 1: DETAILS TABLE -->
            {#if prefs.viewMode === 'details'}
              <div class="table-wrap">
                <table class="details-table">
                  <thead>
                    <tr>
                      <th class="col-check">
                        <input
                          type="checkbox"
                          aria-label="Chọn tất cả tài liệu cá nhân"
                          checked={allVisibleMutableIds.length > 0 && allVisibleMutableIds.every((id) => selectedIds[id])}
                          onchange={toggleSelectAllVisible}
                        />
                      </th>
                      <th>
                        <button type="button" class="th-sort" onclick={() => toggleSortColumn('title')}>
                          Tên {prefs.sortBy === 'title' ? (prefs.sortDir === 'asc' ? '↑' : '↓') : ''}
                        </button>
                      </th>
                      <th>
                        <button type="button" class="th-sort" onclick={() => toggleSortColumn('kind')}>
                          Loại {prefs.sortBy === 'kind' ? (prefs.sortDir === 'asc' ? '↑' : '↓') : ''}
                        </button>
                      </th>
                      <th>Nguồn</th>
                      <th>Thư mục</th>
                      <th>Thẻ</th>
                      <th>
                        <button type="button" class="th-sort" onclick={() => toggleSortColumn('createdAt')}>
                          Ngày thêm {prefs.sortBy === 'createdAt' ? (prefs.sortDir === 'asc' ? '↑' : '↓') : ''}
                        </button>
                      </th>
                      <th class="col-actions">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each group.items as item (item.id)}
                      <tr
                        class:selected={Boolean(selectedIds[item.id])}
                        draggable={item.source !== 'builtin'}
                        ondragstart={(e) => handleDragStart(e, item)}
                        oncontextmenu={(e) => {
                          e.preventDefault();
                          menuItemId = menuItemId === item.id ? null : item.id;
                        }}
                      >
                        <td class="col-check">
                          {#if item.source !== 'builtin'}
                            <input
                              type="checkbox"
                              aria-label={`Chọn ${item.title}`}
                              checked={Boolean(selectedIds[item.id])}
                              onchange={(e) => toggleSelectItem(item.id, (e.currentTarget as HTMLInputElement).checked)}
                            />
                          {/if}
                        </td>
                        <td>
                          <button type="button" class="item-open-link" onclick={() => onOpenItem(item)}>
                            <span class="item-icon" aria-hidden="true">{getKindIcon(item.kind, item.mimeType)}</span>
                            <span>{item.title}</span>
                          </button>
                        </td>
                        <td><span class="meta-chip">{getKindLabel(item.kind, item.mimeType)}</span></td>
                        <td class="muted-cell">{getSourceLabel(item.source)}</td>
                        <td class="muted-cell">
                          {item.source === 'builtin' ? 'TheoLab' : getFolderPathLabel(folders, item.folderId)}
                        </td>
                        <td>
                          <div class="inline-tags">
                            {#each item.tags as tag (tag)}
                              <span class="mini-tag">#{tag}</span>
                            {/each}
                          </div>
                        </td>
                        <td class="muted-cell">{formatDate(item.createdAt)}</td>
                        <td class="col-actions">
                          <div class="action-cell">
                            {#if isDockable(item) && onOpenInDock}
                              <button
                                type="button"
                                class="mini-btn"
                                title="Mở sang khung phải"
                                onclick={() => onOpenInDock?.(item)}
                              >
                                ◫
                              </button>
                            {/if}
                            <button
                              type="button"
                              class="mini-btn"
                              aria-label={`Menu thao tác cho ${item.title}`}
                              aria-expanded={menuItemId === item.id}
                              onclick={() => (menuItemId = menuItemId === item.id ? null : item.id)}
                            >
                              ⋯
                            </button>
                            {#if menuItemId === item.id}
                              <div class="context-popover" role="menu">
                                <button type="button" role="menuitem" onclick={() => { menuItemId = null; onOpenItem(item); }}>
                                  Mở tài liệu
                                </button>
                                {#if isDockable(item) && onOpenInDock}
                                  <button type="button" role="menuitem" onclick={() => { menuItemId = null; onOpenInDock?.(item); }}>
                                    ◫ Mở sang khung phải
                                  </button>
                                {/if}
                                {#if onAttachToChat}
                                  <button type="button" role="menuitem" onclick={() => { menuItemId = null; onAttachToChat?.(item); }}>
                                    ✦ Đính kèm vào Chat AI
                                  </button>
                                {/if}
                                {#if item.source !== 'builtin'}
                                  <button type="button" role="menuitem" onclick={() => openEditDialog(item)}>
                                    ✎ Đổi tên / Sửa thẻ / Chuyển thư mục
                                  </button>
                                  <button type="button" role="menuitem" class="danger-text" onclick={() => handleDeleteItem(item)}>
                                    × Xóa khỏi thư viện
                                  </button>
                                {/if}
                              </div>
                            {/if}
                          </div>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

            <!-- VIEW 2: COMPACT LIST -->
            {:else if prefs.viewMode === 'list'}
              <div class="compact-list">
                {#each group.items as item (item.id)}
                  <article
                    class="list-item-row"
                    class:selected={Boolean(selectedIds[item.id])}
                    draggable={item.source !== 'builtin'}
                    ondragstart={(e) => handleDragStart(e, item)}
                    oncontextmenu={(e) => {
                      e.preventDefault();
                      menuItemId = menuItemId === item.id ? null : item.id;
                    }}
                  >
                    {#if item.source !== 'builtin'}
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${item.title}`}
                        checked={Boolean(selectedIds[item.id])}
                        onchange={(e) => toggleSelectItem(item.id, (e.currentTarget as HTMLInputElement).checked)}
                      />
                    {/if}
                    <button type="button" class="list-item-open" onclick={() => onOpenItem(item)}>
                      <span class="item-icon" aria-hidden="true">{getKindIcon(item.kind, item.mimeType)}</span>
                      <span class="list-item-copy">
                        <strong>{item.title}</strong>
                        <small>
                          {getKindLabel(item.kind, item.mimeType)} · {getSourceLabel(item.source)}
                          {#if item.source !== 'builtin' && item.folderId}
                            · {getFolderPathLabel(folders, item.folderId)}
                          {/if}
                          {#if item.tags.length}
                            · {item.tags.map((t) => `#${t}`).join(' ')}
                          {/if}
                        </small>
                      </span>
                    </button>
                    <div class="action-cell">
                      {#if isDockable(item) && onOpenInDock}
                        <button type="button" class="mini-btn" title="Mở sang khung phải" onclick={() => onOpenInDock?.(item)}>◫</button>
                      {/if}
                      <button
                        type="button"
                        class="mini-btn"
                        aria-label={`Menu thao tác cho ${item.title}`}
                        onclick={() => (menuItemId = menuItemId === item.id ? null : item.id)}
                      >
                        ⋯
                      </button>
                      {#if menuItemId === item.id}
                        <div class="context-popover" role="menu">
                          <button type="button" role="menuitem" onclick={() => { menuItemId = null; onOpenItem(item); }}>Mở tài liệu</button>
                          {#if isDockable(item) && onOpenInDock}
                            <button type="button" role="menuitem" onclick={() => { menuItemId = null; onOpenInDock?.(item); }}>◫ Mở sang khung phải</button>
                          {/if}
                          {#if onAttachToChat}
                            <button type="button" role="menuitem" onclick={() => { menuItemId = null; onAttachToChat?.(item); }}>✦ Đính kèm vào Chat AI</button>
                          {/if}
                          {#if item.source !== 'builtin'}
                            <button type="button" role="menuitem" onclick={() => openEditDialog(item)}>✎ Đổi tên / Sửa thẻ / Chuyển thư mục</button>
                            <button type="button" role="menuitem" class="danger-text" onclick={() => handleDeleteItem(item)}>× Xóa</button>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  </article>
                {/each}
              </div>

            <!-- VIEW 3: ICON / GRID (3 sizes: sm / md / lg) -->
            {:else}
              <div class={`icon-grid size-${prefs.gridSize}`}>
                {#each group.items as item (item.id)}
                  <article
                    class="grid-card"
                    class:selected={Boolean(selectedIds[item.id])}
                    draggable={item.source !== 'builtin'}
                    ondragstart={(e) => handleDragStart(e, item)}
                    oncontextmenu={(e) => {
                      e.preventDefault();
                      menuItemId = menuItemId === item.id ? null : item.id;
                    }}
                  >
                    <div class="grid-card-top">
                      {#if item.source !== 'builtin'}
                        <input
                          type="checkbox"
                          aria-label={`Chọn ${item.title}`}
                          checked={Boolean(selectedIds[item.id])}
                          onchange={(e) => toggleSelectItem(item.id, (e.currentTarget as HTMLInputElement).checked)}
                        />
                      {:else}
                        <span class="meta-chip">TheoLab</span>
                      {/if}
                      <div class="action-cell">
                        {#if isDockable(item) && onOpenInDock}
                          <button type="button" class="mini-btn" title="Mở sang khung phải" onclick={() => onOpenInDock?.(item)}>◫</button>
                        {/if}
                        <button
                          type="button"
                          class="mini-btn"
                          aria-label={`Menu thao tác cho ${item.title}`}
                          onclick={() => (menuItemId = menuItemId === item.id ? null : item.id)}
                        >
                          ⋯
                        </button>
                        {#if menuItemId === item.id}
                          <div class="context-popover" role="menu">
                            <button type="button" role="menuitem" onclick={() => { menuItemId = null; onOpenItem(item); }}>Mở tài liệu</button>
                            {#if isDockable(item) && onOpenInDock}
                              <button type="button" role="menuitem" onclick={() => { menuItemId = null; onOpenInDock?.(item); }}>◫ Mở sang khung phải</button>
                            {/if}
                            {#if onAttachToChat}
                              <button type="button" role="menuitem" onclick={() => { menuItemId = null; onAttachToChat?.(item); }}>✦ Đính kèm vào Chat AI</button>
                            {/if}
                            {#if item.source !== 'builtin'}
                              <button type="button" role="menuitem" onclick={() => openEditDialog(item)}>✎ Đổi tên / Sửa thẻ / Chuyển thư mục</button>
                              <button type="button" role="menuitem" class="danger-text" onclick={() => handleDeleteItem(item)}>× Xóa</button>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    </div>
                    <button type="button" class="grid-card-body" onclick={() => onOpenItem(item)}>
                      <span class="grid-big-icon" aria-hidden="true">{getKindIcon(item.kind, item.mimeType)}</span>
                      <strong class="grid-title">{item.title}</strong>
                      <small class="muted-cell">{getKindLabel(item.kind, item.mimeType)}</small>
                      {#if item.tags.length}
                        <div class="inline-tags">
                          {#each item.tags.slice(0, 3) as tag (tag)}
                            <span class="mini-tag">#{tag}</span>
                          {/each}
                        </div>
                      {/if}
                    </button>
                  </article>
                {/each}
              </div>
            {/if}
          {/each}
        {/if}
      </section>
    </div>
  </div>
{/if}

<style>
  /* Shared controls */
  .pill-btn {
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--text-primary);
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 550;
    transition: background 0.15s ease;
    white-space: nowrap;
  }

  .pill-btn:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .pill-btn.primary {
    background: var(--accent-solid);
    color: #fff;
  }

  .pill-btn.primary:hover:not(:disabled) {
    opacity: 0.92;
  }

  .pill-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .mini-pill {
    padding: 6px 12px;
    font-size: 12px;
  }

  .mini-btn {
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--text-secondary);
    padding: 4px 7px;
    font-size: 13px;
    line-height: 1.2;
  }

  .mini-btn:hover {
    background: var(--surface-hover);
  }

  .danger-text {
    color: var(--error);
  }

  .white-field {
    background: #fff;
    padding: 9px 12px;
    border-radius: 13px;
    font-size: 13px;
  }

  .compact-field {
    padding: 8px 11px;
    border-radius: 12px;
    font-size: 12px;
    margin: 0;
  }

  /* Drawer mode */
  .lib-drawer {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .drawer-search {
    margin-bottom: 2px;
    padding: 10px 13px;
    font-size: 13px;
  }

  .drawer-actions {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .drawer-add-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border-radius: 14px;
    background: var(--surface-elevated);
  }

  .drawer-groups {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .drawer-group-heading {
    margin: 14px 8px 4px;
  }

  .drawer-item-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .drawer-entry {
    flex: 1;
    min-width: 0;
  }

  .compact-icon-btn {
    min-width: 34px;
    height: 34px;
    padding: 0 8px;
    font-size: 15px;
  }

  /* Full mode */
  .lib-shell {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .lib-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .header-actions,
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .mobile-only {
    display: none;
  }

  .error-banner {
    padding: 12px 15px;
    border-radius: 14px;
    background: #fce8e6;
    color: var(--error);
    font-size: 13px;
  }

  .surface-panel {
    background: var(--surface-card);
    border-radius: var(--radius-card);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .add-form strong {
    font-size: 14px;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  .field-box {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .ai-suggest-panel {
    background: #e9f1fc;
  }

  .panel-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .suggest-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .suggest-row {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 9px 11px;
    border-radius: 13px;
    background: #fff;
    cursor: pointer;
  }

  .suggest-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
  }

  .suggest-copy small {
    color: var(--text-muted);
  }

  .lib-layout {
    display: grid;
    grid-template-columns: 230px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }

  .lib-sidebar {
    background: var(--surface-card);
    border-radius: var(--radius-card);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .sidebar-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .sidebar-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .sidebar-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .folder-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: 14px;
    background: var(--surface-elevated);
    margin-bottom: 6px;
  }

  .folder-row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: 12px;
  }

  .folder-row.depth-0 { padding-left: 0; }
  .folder-row.depth-1 { padding-left: 12px; }
  .folder-row.depth-2 { padding-left: 24px; }
  .folder-row.depth-3 { padding-left: 34px; }

  .folder-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    flex: 1;
    min-width: 0;
    border: 0;
    border-radius: 12px;
    background: transparent;
    padding: 8px 10px;
    text-align: left;
    font-size: 13px;
    color: var(--text-primary);
  }

  .folder-btn:hover,
  .folder-btn.selected {
    background: #fff;
  }

  .folder-btn.selected {
    font-weight: 600;
    color: var(--accent-solid);
  }

  .folder-btn.drag-over,
  .folder-row.drag-over {
    background: #d7e5fb;
  }

  .folder-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .system-folder {
    margin-top: 6px;
  }

  .count-pill {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--surface-elevated);
    padding: 1px 7px;
    border-radius: var(--radius-pill);
  }

  .tag-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .tag-pill {
    border: 0;
    border-radius: var(--radius-pill);
    background: #fff;
    color: var(--text-secondary);
    padding: 5px 10px;
    font-size: 12px;
  }

  .tag-pill:hover,
  .tag-pill.selected {
    background: var(--accent-solid);
    color: #fff;
  }

  .lib-main {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .toolbar-card {
    background: var(--surface-card);
    border-radius: var(--radius-card);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .toolbar-search {
    width: 100%;
  }

  .toolbar-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .toolbar-select {
    width: auto;
    min-width: 126px;
  }

  .view-switch {
    display: inline-flex;
    gap: 3px;
    padding: 3px;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
  }

  .view-btn {
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text-secondary);
    padding: 6px 11px;
    font-size: 12px;
  }

  .view-btn.active {
    background: #fff;
    color: var(--accent-solid);
    font-weight: 600;
  }

  .bulk-bar {
    background: #e9f1fc;
    border-radius: 16px;
    padding: 10px 14px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
  }

  .bulk-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .bulk-tag-input {
    width: 150px;
  }

  .bulk-rename-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .group-heading {
    margin: 8px 4px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .empty-card {
    background: var(--surface-card);
    border-radius: var(--radius-card);
    padding: 28px;
    text-align: center;
    color: var(--text-muted);
  }

  /* Details Table */
  .table-wrap {
    background: var(--surface-card);
    border-radius: var(--radius-card);
    padding: 8px 10px;
    overflow-x: auto;
  }

  .details-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 4px;
    font-size: 13px;
  }

  .details-table th {
    text-align: left;
    padding: 8px 10px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }

  .th-sort {
    border: 0;
    background: transparent;
    padding: 0;
    color: inherit;
    font-weight: 600;
  }

  .details-table tbody tr {
    background: #fff;
    transition: background 0.14s ease;
  }

  .details-table tbody tr:hover {
    background: var(--surface-hover);
  }

  .details-table tbody tr.selected {
    background: #e9f1fc;
  }

  .details-table td {
    padding: 9px 10px;
    vertical-align: middle;
  }

  .details-table td:first-child {
    border-radius: 12px 0 0 12px;
  }

  .details-table td:last-child {
    border-radius: 0 12px 12px 0;
  }

  .col-check {
    width: 34px;
  }

  .col-actions {
    width: 84px;
    text-align: right;
  }

  .item-open-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: transparent;
    padding: 0;
    text-align: left;
    font-weight: 550;
    color: var(--text-primary);
  }

  .item-icon {
    font-size: 15px;
    flex: 0 0 auto;
  }

  .meta-chip {
    display: inline-block;
    padding: 3px 8px;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .muted-cell {
    color: var(--text-muted);
    font-size: 12px;
    white-space: nowrap;
  }

  .inline-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .mini-tag {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: var(--radius-pill);
    background: var(--surface-card);
    color: var(--accent-solid);
  }

  .action-cell {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .context-popover {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 25;
    min-width: 210px;
    padding: 6px;
    border-radius: 16px;
    background: #fff;
    box-shadow: var(--shadow-float);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .context-popover button {
    border: 0;
    border-radius: 10px;
    background: transparent;
    padding: 8px 11px;
    text-align: left;
    font-size: 12px;
  }

  .context-popover button:hover {
    background: var(--surface-elevated);
  }

  /* Compact List View */
  .compact-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .list-item-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 16px;
    background: var(--surface-card);
    transition: background 0.14s ease;
  }

  .list-item-row:hover {
    background: var(--surface-hover);
  }

  .list-item-row.selected {
    background: #e9f1fc;
  }

  .list-item-open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    border: 0;
    background: transparent;
    padding: 0;
    text-align: left;
  }

  .list-item-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .list-item-copy strong {
    font-size: 14px;
    font-weight: 550;
  }

  .list-item-copy small {
    font-size: 12px;
    color: var(--text-muted);
  }

  /* Grid / Icon View */
  .icon-grid {
    display: grid;
    gap: 12px;
  }

  .icon-grid.size-sm {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }

  .icon-grid.size-md {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  }

  .icon-grid.size-lg {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  }

  .grid-card {
    background: var(--surface-card);
    border-radius: var(--radius-card);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: background 0.15s ease;
  }

  .grid-card:hover {
    background: var(--surface-hover);
  }

  .grid-card.selected {
    background: #e9f1fc;
  }

  .grid-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .grid-card-body {
    border: 0;
    background: transparent;
    padding: 4px 2px;
    text-align: left;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .grid-big-icon {
    font-size: 28px;
    line-height: 1;
  }

  .icon-grid.size-lg .grid-big-icon {
    font-size: 38px;
  }

  .icon-grid.size-sm .grid-big-icon {
    font-size: 22px;
  }

  .grid-title {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  @media (max-width: 820px) {
    .mobile-only {
      display: inline-flex;
    }

    .lib-layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .lib-sidebar {
      display: none;
    }

    .lib-sidebar.mobile-open {
      display: flex;
    }
  }
</style>
