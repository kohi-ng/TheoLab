<script lang="ts">
  import { APP_MODE, isGooglePickerConfigured } from '../../config/runtimeConfig.js';
  import {
    createGoogleWorkspaceFile,
    defaultNewFileTitle,
    listDriveFolderFiles,
    type NewGoogleFileKind,
  } from '../../core/googleDriveApi';
  import { openGoogleDrivePicker } from '../../core/googlePicker';
  import { libraryStore } from './libraryStore.svelte';
  import {
    applyBatchRenameToDrafts,
    buildLibraryInputsFromDrafts,
    describeDriveMimeType,
    mapPickerDocToDraft,
    validateDriveUrl,
    type DriveImportDraft,
  } from '../../domain/library/driveMapper';
  import {
    buildFolderTree,
    flattenFolderTree,
    getKindIcon,
    normalizeTags,
  } from '../../domain/library/query';
  import {
    detectMimeTypeFromDriveUrl,
    extractDriveFileId,
  } from '../../domain/library/migrations';
  import type { LibraryItemView } from '../../domain/library/schemas';

  export type ImportTabMode = 'picker' | 'link' | 'create';

  let {
    initialTab = 'picker',
    defaultFolderId = null,
    onClose,
    onImported,
    onToast,
  }: {
    initialTab?: ImportTabMode;
    defaultFolderId?: string | null;
    onClose: () => void;
    onImported?: (items: LibraryItemView[]) => void;
    onToast?: (message: string) => void;
  } = $props();

  let activeTab = $state<ImportTabMode>('picker');
  $effect(() => {
    activeTab = initialTab;
  });

  // Draft rows in "Xác nhận & đặt tên"
  let drafts = $state<DriveImportDraft[]>([]);
  let globalFolderId = $state<string>('');
  let globalTagsRaw = $state('');
  let batchPrefix = $state('');
  let batchSuffix = $state('');
  let batchStripExt = $state(false);
  let showBatchTools = $state(false);

  // Picker state
  let picking = $state(false);
  let pickerError = $state('');
  let pickerHint = $state('');
  let expandingFolderIds = $state<Record<string, boolean>>({});
  let folderExpandNotes = $state<Record<string, string>>({});

  // Manual link fallback state
  let linkUrl = $state('');
  let linkTitle = $state('');
  let linkError = $state('');

  // Create new Google Doc/Sheet state
  let createKind = $state<NewGoogleFileKind>('document');
  let createTitle = $state(defaultNewFileTitle('document'));
  let createFolderId = $state<string>('');
  let createTagsRaw = $state('');
  let createDesc = $state('');
  let creatingDoc = $state(false);
  let createError = $state('');

  // Saving state
  let savingAll = $state(false);

  $effect(() => {
    const initial = defaultFolderId ?? '';
    globalFolderId = initial;
    createFolderId = initial;
  });

  const flatFolders = $derived(flattenFolderTree(buildFolderTree(libraryStore.folders)));
  const pickerAvailable = $derived(APP_MODE === 'firebase_auth' && isGooglePickerConfigured());

  const activeDraftCount = $derived(
    drafts.filter((d) => d.selected && !(d.isFolder && d.folderAction === 'expand')).length,
  );

  async function handleOpenPicker(forceRefreshToken = false) {
    picking = true;
    pickerError = '';
    pickerHint = '';
    try {
      const result = await openGoogleDrivePicker({ forceRefreshToken });
      if (result.cancelled) {
        pickerHint = 'Bạn đã hủy chọn tệp từ Google Drive.';
        return;
      }
      if (!result.docs.length) {
        pickerHint = 'Không có tệp hoặc thư mục nào được chọn.';
        return;
      }
      const globalTags = normalizeTags(globalTagsRaw.split(','));
      const existingFileIds = new Set(drafts.map((d) => d.driveFileId));
      const newDrafts: DriveImportDraft[] = [];
      for (const doc of result.docs) {
        if (existingFileIds.has(doc.id)) continue;
        newDrafts.push(
          mapPickerDocToDraft(doc, {
            folderId: globalFolderId || null,
            tags: globalTags,
          }),
        );
      }
      drafts = [...drafts, ...newDrafts];
      pickerHint = `Đã chọn ${newDrafts.length} mục từ Google Drive. Kiểm tra tên, thư mục và bấm "Thêm tất cả".`;
    } catch (error) {
      pickerError = (error as Error).message;
    } finally {
      picking = false;
    }
  }

  async function handleFolderActionChange(draft: DriveImportDraft, action: 'link' | 'expand') {
    drafts = drafts.map((d) => (d.draftId === draft.draftId ? { ...d, folderAction: action } : d));
    if (action === 'link') {
      // Remove any previously expanded child rows from this folder
      drafts = drafts.filter((d) => d.fromFolderId !== draft.driveFileId);
      return;
    }

    // Expand folder children via Drive API v3
    expandingFolderIds = { ...expandingFolderIds, [draft.driveFileId]: true };
    folderExpandNotes = { ...folderExpandNotes, [draft.driveFileId]: '' };
    try {
      const children = await listDriveFolderFiles(draft.driveFileId);
      if (!children.length) {
        folderExpandNotes = {
          ...folderExpandNotes,
          [draft.driveFileId]:
            'Không tìm thấy tệp con nào có thể đọc trong thư mục này (do phạm vi quyền drive.file chỉ cấp quyền cho tệp được chọn trực tiếp). Bạn có thể giữ lựa chọn "Thêm liên kết thư mục" hoặc mở lại Picker, vào trong thư mục và chọn nhiều tệp.',
        };
        return;
      }
      const existingIds = new Set(drafts.map((d) => d.driveFileId));
      const childDrafts = children
        .filter((child) => !existingIds.has(child.id))
        .map((child) =>
          mapPickerDocToDraft(
            {
              id: child.id,
              name: child.name,
              mimeType: child.mimeType,
              url: child.webViewLink,
            },
            {
              folderId: draft.folderId,
              tags: draft.tags,
              fromFolderId: draft.driveFileId,
            },
          ),
        );
      drafts = [...drafts, ...childDrafts];
      folderExpandNotes = {
        ...folderExpandNotes,
        [draft.driveFileId]: `Đã nạp ${childDrafts.length} tệp bên trong thư mục "${draft.title}". Bạn có thể bỏ chọn hoặc đổi tên từng tệp bên dưới.`,
      };
    } catch (error) {
      folderExpandNotes = {
        ...folderExpandNotes,
        [draft.driveFileId]: (error as Error).message,
      };
    } finally {
      expandingFolderIds = { ...expandingFolderIds, [draft.driveFileId]: false };
    }
  }

  function handleAddManualLinkToDrafts(event: SubmitEvent) {
    event.preventDefault();
    linkError = '';
    const url = linkUrl.trim();
    const title = linkTitle.trim();
    if (!title) {
      linkError = 'Nhập tên tài liệu trước khi thêm.';
      return;
    }
    if (!validateDriveUrl(url)) {
      linkError = 'Chỉ chấp nhận liên kết hợp lệ từ https://drive.google.com hoặc https://docs.google.com.';
      return;
    }
    const driveFileId = extractDriveFileId(url) ?? `link-${Date.now().toString(36)}`;
    const mimeType = detectMimeTypeFromDriveUrl(url);
    const draft = mapPickerDocToDraft(
      { id: driveFileId, name: title, mimeType, url },
      {
        folderId: globalFolderId || null,
        tags: normalizeTags(globalTagsRaw.split(',')),
      },
    );
    drafts = [...drafts, draft];
    linkUrl = '';
    linkTitle = '';
    activeTab = 'picker';
    pickerHint = `Đã đưa "${title}" vào danh sách xác nhận bên dưới.`;
  }

  function handleApplyGlobalFolderAndTags() {
    const tags = normalizeTags(globalTagsRaw.split(','));
    drafts = drafts.map((d) => ({
      ...d,
      folderId: globalFolderId || null,
      tags: tags.length ? normalizeTags([...d.tags, ...tags]) : d.tags,
    }));
    onToast?.('Đã áp dụng thư mục và thẻ cho danh sách xem trước.');
  }

  function handleApplyBatchRename() {
    drafts = applyBatchRenameToDrafts(drafts, {
      prefix: batchPrefix,
      suffix: batchSuffix,
      stripExtension: batchStripExt,
    });
    batchPrefix = '';
    batchSuffix = '';
    batchStripExt = false;
    showBatchTools = false;
    onToast?.('Đã áp dụng đổi tên hàng loạt.');
  }

  function removeDraft(draftId: string) {
    drafts = drafts.filter((d) => d.draftId !== draftId);
  }

  async function handleConfirmAddAll() {
    if (savingAll) return;
    savingAll = true;
    pickerError = '';
    try {
      const prepared = buildLibraryInputsFromDrafts(drafts);
      if (!prepared.length) {
        pickerError = 'Chưa có tài liệu nào được chọn để thêm.';
        return;
      }
      const created: LibraryItemView[] = [];
      for (const input of prepared) {
        created.push(await libraryStore.createItem(input));
      }
      onToast?.(`Đã thêm ${created.length} tài liệu vào Thư viện.`);
      onImported?.(created);
      onClose();
    } catch (error) {
      pickerError = (error as Error).message;
    } finally {
      savingAll = false;
    }
  }

  async function handleCreateNewWorkspaceFile(event: SubmitEvent) {
    event.preventDefault();
    if (creatingDoc) return;
    creatingDoc = true;
    createError = '';
    try {
      const title = createTitle.trim() || defaultNewFileTitle(createKind);
      const createdFile = await createGoogleWorkspaceFile({ kind: createKind, title });
      const mimeType =
        createKind === 'spreadsheets'
          ? 'application/vnd.google-apps.spreadsheet'
          : 'application/vnd.google-apps.document';
      const item = await libraryStore.createItem({
        title: createdFile.name,
        kind: createKind === 'spreadsheets' ? 'google-sheet' : 'google-doc',
        source: 'drive',
        url: createdFile.url,
        driveFileId: createdFile.id,
        mimeType,
        folderId: createFolderId || null,
        tags: normalizeTags(createTagsRaw.split(',')),
        description: createDesc.trim() || undefined,
      });
      onToast?.(`Đã tạo "${item.title}" trên Google Drive và lưu vào Thư viện.`);
      onImported?.([item]);
      onClose();
    } catch (error) {
      createError = (error as Error).message;
    } finally {
      creatingDoc = false;
    }
  }
</script>

<div class="import-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <div class="import-dialog" role="dialog" aria-modal="true" aria-label="Thêm tài liệu từ Google Drive">
    <header class="dialog-head">
      <div>
        <h2>Thêm từ Google Drive — Chọn &amp; đặt tên</h2>
        <p class="status-line">
          TheoLab chỉ lưu liên kết, mã tệp và metadata đã kiểm duyệt — không tự động tải nội dung tệp về hệ thống.
        </p>
      </div>
      <button type="button" class="close-btn" aria-label="Đóng hộp thoại" onclick={onClose}>×</button>
    </header>

    <nav class="dialog-tabs" aria-label="Phương thức thêm tài liệu">
      <button type="button" class="tab-pill" class:active={activeTab === 'picker'} onclick={() => (activeTab = 'picker')}>
        ☁ Chọn từ Google Drive ({drafts.length})
      </button>
      <button type="button" class="tab-pill" class:active={activeTab === 'link'} onclick={() => (activeTab = 'link')}>
        🔗 Dán liên kết thủ công
      </button>
      <button type="button" class="tab-pill" class:active={activeTab === 'create'} onclick={() => (activeTab = 'create')}>
        ＋ Tạo Google Doc / Sheet mới
      </button>
    </nav>

    <!-- TAB 1: GOOGLE PICKER + CONFIRMATION & NAMING TABLE -->
    {#if activeTab === 'picker'}
      <div class="tab-body">
        {#if APP_MODE !== 'firebase_auth'}
          <div class="notice-banner">
            Đang ở chế độ <strong>dev_mock</strong>: Chọn trực tiếp từ Google Drive cần chế độ <code>firebase_auth</code> đã đăng nhập Google. Bạn vẫn có thể thêm tài liệu qua tab <strong>Dán liên kết thủ công</strong>.
          </div>
        {:else if !isGooglePickerConfigured()}
          <div class="notice-banner">
            Chưa thiết lập <code>VITE_GOOGLE_PICKER_API_KEY</code> và <code>VITE_GOOGLE_PICKER_APP_ID</code> (xem hướng dẫn bật Google Picker API trong <code>SETUP.md</code>). Bạn có thể chuyển sang tab <strong>Dán liên kết thủ công</strong>.
          </div>
        {/if}

        <div class="picker-bar">
          <button
            type="button"
            class="pill-btn primary"
            disabled={picking}
            onclick={() => handleOpenPicker(false)}
          >
            {picking ? 'Đang mở Google Drive Picker…' : drafts.length ? '＋ Chọn thêm từ Google Drive' : '☁ Mở Google Drive Picker'}
          </button>
          {#if pickerAvailable}
            <button type="button" class="pill-btn" disabled={picking} onclick={() => handleOpenPicker(true)}>
              ↻ Làm mới quyền Drive
            </button>
          {/if}
          <button type="button" class="pill-btn" onclick={() => (activeTab = 'link')}>
            Hoặc dán liên kết thủ công
          </button>
        </div>

        {#if pickerError}
          <div class="error-banner">{pickerError}</div>
        {/if}
        {#if pickerHint}
          <div class="info-banner">{pickerHint}</div>
        {/if}

        {#if drafts.length > 0}
          <!-- Bulk defaults for picked items -->
          <div class="bulk-defaults">
            <label class="field-inline">
              <span>Thư mục mặc định</span>
              <select class="select-input white-field" bind:value={globalFolderId}>
                <option value="">Chưa phân thư mục</option>
                {#each flatFolders as node (node.folder.id)}
                  <option value={node.folder.id}>{'— '.repeat(node.depth)}{node.folder.name}</option>
                {/each}
              </select>
            </label>
            <label class="field-inline">
              <span>Thẻ gắn chung (phẩy)</span>
              <input class="text-input white-field" type="text" placeholder="hóa phân tích, chương 3" bind:value={globalTagsRaw} />
            </label>
            <button type="button" class="pill-btn" onclick={handleApplyGlobalFolderAndTags}>
              Áp dụng cho tất cả
            </button>
            <button type="button" class="pill-btn" onclick={() => (showBatchTools = !showBatchTools)}>
              ✎ Đổi tên hàng loạt
            </button>
          </div>

          {#if showBatchTools}
            <div class="batch-rename-bar">
              <input class="text-input white-field" type="text" placeholder="Thêm tiền tố (VD: [HPT] )" bind:value={batchPrefix} />
              <input class="text-input white-field" type="text" placeholder="Thêm hậu tố (VD: · 2026)" bind:value={batchSuffix} />
              <label class="check-inline">
                <input type="checkbox" bind:checked={batchStripExt} />
                <span>Bỏ đuôi file (.pdf, .docx…)</span>
              </label>
              <button type="button" class="pill-btn primary" onclick={handleApplyBatchRename}>Áp dụng đổi tên</button>
            </div>
          {/if}

          <!-- Confirmation & Naming Table -->
          <div class="draft-table-wrap">
            <table class="draft-table">
              <thead>
                <tr>
                  <th class="col-check">Chọn</th>
                  <th>Tên hiển thị trong Thư viện</th>
                  <th>Loại</th>
                  <th>Thư mục đích</th>
                  <th>Thẻ &amp; Ghi chú</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each drafts as draft (draft.draftId)}
                  <tr class:unchecked={!draft.selected}>
                    <td class="col-check">
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${draft.title}`}
                        checked={draft.selected}
                        onchange={(e) => {
                          drafts = drafts.map((d) =>
                            d.draftId === draft.draftId
                              ? { ...d, selected: (e.currentTarget as HTMLInputElement).checked }
                              : d,
                          );
                        }}
                      />
                    </td>
                    <td>
                      <input
                        class="text-input white-field row-input"
                        type="text"
                        required
                        aria-label="Tên tài liệu"
                        value={draft.title}
                        oninput={(e) => {
                          drafts = drafts.map((d) =>
                            d.draftId === draft.draftId
                              ? { ...d, title: (e.currentTarget as HTMLInputElement).value }
                              : d,
                          );
                        }}
                      />
                      {#if draft.isFolder}
                        <div class="folder-choice">
                          <label class="check-inline">
                            <input
                              type="radio"
                              name={`folder-mode-${draft.draftId}`}
                              checked={draft.folderAction === 'link'}
                              onchange={() => handleFolderActionChange(draft, 'link')}
                            />
                            <span>Thêm liên kết thư mục</span>
                          </label>
                          <label class="check-inline">
                            <input
                              type="radio"
                              name={`folder-mode-${draft.draftId}`}
                              checked={draft.folderAction === 'expand'}
                              disabled={Boolean(expandingFolderIds[draft.driveFileId])}
                              onchange={() => handleFolderActionChange(draft, 'expand')}
                            />
                            <span>
                              {expandingFolderIds[draft.driveFileId]
                                ? 'Đang duyệt tệp con…'
                                : 'Thêm từng tệp bên trong'}
                            </span>
                          </label>
                          {#if folderExpandNotes[draft.driveFileId]}
                            <p class="status-line folder-note">{folderExpandNotes[draft.driveFileId]}</p>
                          {/if}
                        </div>
                      {/if}
                    </td>
                    <td>
                      <span class="kind-pill">
                        {getKindIcon(draft.kind, draft.mimeType)} {describeDriveMimeType(draft.mimeType)}
                      </span>
                    </td>
                    <td>
                      <select
                        class="select-input white-field row-input"
                        value={draft.folderId ?? ''}
                        aria-label="Thư mục thư viện"
                        onchange={(e) => {
                          const val = (e.currentTarget as HTMLSelectElement).value || null;
                          drafts = drafts.map((d) =>
                            d.draftId === draft.draftId ? { ...d, folderId: val } : d,
                          );
                        }}
                      >
                        <option value="">Chưa phân thư mục</option>
                        {#each flatFolders as node (node.folder.id)}
                          <option value={node.folder.id}>{'— '.repeat(node.depth)}{node.folder.name}</option>
                        {/each}
                      </select>
                    </td>
                    <td>
                      <div class="meta-stack">
                        <input
                          class="text-input white-field row-input"
                          type="text"
                          placeholder="Thẻ (phẩy)…"
                          value={draft.tags.join(', ')}
                          onchange={(e) => {
                            const tags = normalizeTags((e.currentTarget as HTMLInputElement).value.split(','));
                            drafts = drafts.map((d) =>
                              d.draftId === draft.draftId ? { ...d, tags } : d,
                            );
                          }}
                        />
                        <input
                          class="text-input white-field row-input"
                          type="text"
                          placeholder="Ghi chú ngắn (tùy chọn)…"
                          value={draft.description}
                          oninput={(e) => {
                            drafts = drafts.map((d) =>
                              d.draftId === draft.draftId
                                ? { ...d, description: (e.currentTarget as HTMLInputElement).value }
                                : d,
                            );
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        class="close-btn small-remove"
                        aria-label={`Bỏ ${draft.title}`}
                        onclick={() => removeDraft(draft.draftId)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          <footer class="dialog-footer">
            <span class="status-line">Sẽ thêm <strong>{activeDraftCount}</strong> mục vào Thư viện.</span>
            <div class="footer-actions">
              <button type="button" class="pill-btn" onclick={onClose}>Hủy</button>
              <button
                type="button"
                class="pill-btn primary"
                disabled={savingAll || activeDraftCount === 0}
                onclick={handleConfirmAddAll}
              >
                {savingAll ? 'Đang thêm…' : `Thêm tất cả (${activeDraftCount})`}
              </button>
            </div>
          </footer>
        {/if}
      </div>

    <!-- TAB 2: MANUAL LINK FALLBACK -->
    {:else if activeTab === 'link'}
      <form class="tab-body form-stack" onsubmit={handleAddManualLinkToDrafts}>
        <p class="status-line">
          Phương án dự phòng (hoạt động cả ở <code>dev_mock</code>): dán liên kết Google Drive / Docs / Sheets / Slides và đặt tên để đưa vào danh sách xác nhận.
        </p>
        {#if linkError}
          <div class="error-banner">{linkError}</div>
        {/if}
        <label class="field-box">
          <span>Tên hiển thị trong Thư viện</span>
          <input class="text-input white-field" type="text" required placeholder="VD: Giáo trình Hóa phân tích (PDF)" bind:value={linkTitle} />
        </label>
        <label class="field-box">
          <span>Liên kết Google Drive / Docs / Sheets / Slides</span>
          <input class="text-input white-field" type="url" required placeholder="https://drive.google.com/file/d/… hoặc https://docs.google.com/…" bind:value={linkUrl} />
        </label>
        <div class="field-grid">
          <label class="field-box">
            <span>Thư mục thư viện</span>
            <select class="select-input white-field" bind:value={globalFolderId}>
              <option value="">Chưa phân thư mục</option>
              {#each flatFolders as node (node.folder.id)}
                <option value={node.folder.id}>{'— '.repeat(node.depth)}{node.folder.name}</option>
              {/each}
            </select>
          </label>
          <label class="field-box">
            <span>Thẻ (phân cách dấu phẩy)</span>
            <input class="text-input white-field" type="text" placeholder="hóa phân tích, đề thi" bind:value={globalTagsRaw} />
          </label>
        </div>
        <div class="footer-actions">
          <button type="submit" class="pill-btn primary">Tiếp tục sang màn hình xác nhận</button>
          <button type="button" class="pill-btn" onclick={onClose}>Đóng</button>
        </div>
      </form>

    <!-- TAB 3: CREATE NEW GOOGLE DOC / SHEET -->
    {:else}
      <form class="tab-body form-stack" onsubmit={handleCreateNewWorkspaceFile}>
        <p class="status-line">
          Tạo trực tiếp Google Docs hoặc Google Sheets mới trên Drive của bạn (quyền <code>drive.file</code>) và đặt tên, chọn thư mục lưu vào Thư viện ngay.
        </p>
        {#if APP_MODE !== 'firebase_auth'}
          <div class="notice-banner">
            Tạo tài liệu Google mới yêu cầu chế độ <code>firebase_auth</code> đã đăng nhập Google.
          </div>
        {/if}
        {#if createError}
          <div class="error-banner">{createError}</div>
        {/if}
        <div class="field-grid">
          <label class="field-box">
            <span>Loại tài liệu</span>
            <select
              class="select-input white-field"
              value={createKind}
              onchange={(e) => {
                createKind = (e.currentTarget as HTMLSelectElement).value as NewGoogleFileKind;
                createTitle = defaultNewFileTitle(createKind);
              }}
            >
              <option value="document">▤ Google Docs (Tài liệu)</option>
              <option value="spreadsheets">▦ Google Sheets (Bảng tính)</option>
            </select>
          </label>
          <label class="field-box">
            <span>Tên tài liệu mới</span>
            <input class="text-input white-field" type="text" required bind:value={createTitle} />
          </label>
          <label class="field-box">
            <span>Thư mục thư viện</span>
            <select class="select-input white-field" bind:value={createFolderId}>
              <option value="">Chưa phân thư mục</option>
              {#each flatFolders as node (node.folder.id)}
                <option value={node.folder.id}>{'— '.repeat(node.depth)}{node.folder.name}</option>
              {/each}
            </select>
          </label>
          <label class="field-box">
            <span>Thẻ (phân cách dấu phẩy)</span>
            <input class="text-input white-field" type="text" placeholder="ghi chú, thí nghiệm" bind:value={createTagsRaw} />
          </label>
        </div>
        <label class="field-box">
          <span>Ghi chú (tùy chọn)</span>
          <input class="text-input white-field" type="text" placeholder="Mô tả ngắn mục đích của tài liệu" bind:value={createDesc} />
        </label>
        <div class="footer-actions">
          <button
            type="submit"
            class="pill-btn primary"
            disabled={creatingDoc || APP_MODE !== 'firebase_auth'}
          >
            {creatingDoc ? 'Đang tạo trên Google Drive…' : 'Tạo & Lưu vào Thư viện'}
          </button>
          <button type="button" class="pill-btn" onclick={onClose}>Hủy</button>
        </div>
      </form>
    {/if}
  </div>
</div>

<style>
  .import-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgb(25 32 46 / 42%);
    display: grid;
    place-items: center;
    padding: 16px;
    overflow-y: auto;
  }

  .import-dialog {
    width: min(940px, 100%);
    max-height: min(88vh, 820px);
    overflow-y: auto;
    background: var(--bg-canvas);
    border-radius: 24px;
    padding: 20px 22px;
    box-shadow: var(--shadow-float);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .dialog-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .dialog-head h2 {
    margin: 0 0 4px;
    font-size: 18px;
    font-weight: 600;
  }

  .close-btn {
    border: 0;
    border-radius: 50%;
    width: 36px;
    height: 36px;
    background: var(--surface-elevated);
    font-size: 20px;
    line-height: 1;
    flex: 0 0 auto;
  }

  .close-btn:hover {
    background: var(--surface-hover);
  }

  .small-remove {
    width: 28px;
    height: 28px;
    font-size: 16px;
  }

  .dialog-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 4px;
    border-radius: 16px;
    background: var(--surface-card);
  }

  .tab-pill {
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text-secondary);
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 550;
  }

  .tab-pill.active {
    background: #fff;
    color: var(--accent-solid);
  }

  .tab-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .picker-bar,
  .bulk-defaults,
  .batch-rename-bar,
  .footer-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .bulk-defaults,
  .batch-rename-bar {
    background: var(--surface-card);
    padding: 12px 14px;
    border-radius: 16px;
  }

  .field-inline {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--text-muted);
    flex: 1 1 180px;
  }

  .check-inline {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .check-inline input {
    accent-color: var(--accent-solid);
  }

  .white-field {
    background: #fff;
    padding: 9px 12px;
    border-radius: 12px;
    font-size: 13px;
  }

  .row-input {
    padding: 7px 10px;
    font-size: 12px;
  }

  .pill-btn {
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--text-primary);
    padding: 9px 15px;
    font-size: 13px;
    font-weight: 550;
    white-space: nowrap;
  }

  .pill-btn:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .pill-btn.primary {
    background: var(--accent-solid);
    color: #fff;
  }

  .pill-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .notice-banner,
  .info-banner,
  .error-banner {
    padding: 11px 14px;
    border-radius: 14px;
    font-size: 12px;
    line-height: 1.5;
  }

  .notice-banner,
  .info-banner {
    background: #e9f1fc;
    color: var(--text-secondary);
  }

  .error-banner {
    background: #fce8e6;
    color: var(--error);
  }

  .draft-table-wrap {
    background: var(--surface-card);
    border-radius: 18px;
    padding: 8px 10px;
    overflow-x: auto;
  }

  .draft-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 6px;
    font-size: 12px;
  }

  .draft-table th {
    text-align: left;
    padding: 6px 8px;
    color: var(--text-muted);
    font-weight: 600;
  }

  .draft-table tbody tr {
    background: #fff;
  }

  .draft-table tbody tr.unchecked {
    opacity: 0.5;
  }

  .draft-table td {
    padding: 8px;
    vertical-align: top;
  }

  .draft-table td:first-child {
    border-radius: 12px 0 0 12px;
  }

  .draft-table td:last-child {
    border-radius: 0 12px 12px 0;
  }

  .col-check {
    width: 44px;
    text-align: center;
  }

  .kind-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 9px;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    white-space: nowrap;
    font-size: 11px;
  }

  .meta-stack {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 170px;
  }

  .folder-choice {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--surface-card);
  }

  .folder-note {
    margin: 2px 0 0;
  }

  .dialog-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding-top: 6px;
  }

  .form-stack {
    background: var(--surface-card);
    border-radius: 18px;
    padding: 16px;
  }

  .field-grid {
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
</style>
