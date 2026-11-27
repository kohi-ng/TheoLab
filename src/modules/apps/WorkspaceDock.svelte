<script lang="ts">
  import {
    APP_CATALOG,
    APP_CATEGORIES,
    detectGoogleService,
    extractCalendarEmbedUrl,
    findAppDefinition,
    type DockTab,
    type GoogleEmbedMode,
    type LibraryDockInput,
  } from './appCatalog';
  import { dockStore } from './dockStore.svelte';
  import { saveOwnerVault } from '../../core/secretsVault';
  import { createGoogleWorkspaceFile, type NewGoogleFileKind } from '../../core/googleDriveApi';
  import TheonStage from '../theon/TheonStage.svelte';
  import ExerciseTab from '../theon/ExerciseTab.svelte';

  let {
    onToast,
  }: { onToast?: (message: string) => void } = $props();

  // Launcher popover state ("+" button)
  let launcherUrl = $state('');
  let launcherTitle = $state('');

  // In-tab setup form states keyed by tabId
  let newFileTitleDrafts = $state<Record<string, string>>({});
  let creatingTabId = $state<string | null>(null);
  let createErrorByTab = $state<Record<string, string>>({});
  let googleUrlDrafts = $state<Record<string, string>>({});
  let googleTitleDrafts = $state<Record<string, string>>({});
  let googleModeDrafts = $state<Record<string, GoogleEmbedMode>>({});
  let googleSaveToLibDrafts = $state<Record<string, boolean>>({});
  let calendarDrafts = $state<Record<string, string>>({});
  let calendarSaveToVault = $state(true);

  const activeTab = $derived(dockStore.activeTab);
  const activeApp = $derived(activeTab?.appId ? findAppDefinition(activeTab.appId) : undefined);

  function hostLabel(url: string): string {
    if (!url) return '';
    if (url.startsWith('/')) return 'TheoLab local';
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  function isGoogleLibraryItem(item: LibraryDockInput): boolean {
    if (item.mimeType === 'application/vnd.google-apps.folder') return false;
    return (
      Boolean(item.url) &&
      !item.url!.includes('REPLACE_') &&
      (item.type === 'google' ||
        item.kind === 'google-doc' ||
        item.kind === 'google-sheet' ||
        item.kind === 'google-slide' ||
        item.kind === 'drive-file')
    );
  }

  function matchingLibraryDocs(kind: 'google-doc' | 'google-sheet'): LibraryDockInput[] {
    const wantedService = kind === 'google-sheet' ? 'spreadsheets' : 'document';
    return dockStore.libraryItems.filter((item) => {
      if (!isGoogleLibraryItem(item) || !item.url) return false;
      const service = detectGoogleService(item.url);
      if (service === wantedService) return true;
      return service === 'drive';
    });
  }

  function dockableLibraryItems(): LibraryDockInput[] {
    return dockStore.libraryItems.filter(
      (item) =>
        isGoogleLibraryItem(item)
        || (item.type === 'pdf' && Boolean(item.file))
        || item.type === 'widget'
        || item.kind === 'widget',
    );
  }

  async function handleCreateNewGoogleFile(tab: DockTab, kind: NewGoogleFileKind) {
    if (creatingTabId) return;
    creatingTabId = tab.id;
    createErrorByTab = { ...createErrorByTab, [tab.id]: '' };
    try {
      const created = await createGoogleWorkspaceFile({
        kind,
        title: (newFileTitleDrafts[tab.id] ?? '').trim() || undefined,
      });
      dockStore.updateTabUrl(tab.id, created.url, {
        title: created.name,
        googleMode: 'edit',
      });
      newFileTitleDrafts = { ...newFileTitleDrafts, [tab.id]: '' };
      try {
        await dockStore.saveToLibrary(created.name, created.url);
        onToast?.(`Đã tạo "${created.name}" trên Google Drive và lưu vào Thư viện.`);
      } catch {
        onToast?.(`Đã tạo và mở "${created.name}" trong tab.`);
      }
    } catch (error) {
      const msg = (error as Error).message;
      createErrorByTab = { ...createErrorByTab, [tab.id]: msg };
      onToast?.(msg);
    } finally {
      creatingTabId = null;
    }
  }

  async function handleQuickNewGoogleTab(kind: NewGoogleFileKind) {
    const appId = kind === 'spreadsheets' ? 'google-sheets' : 'google-docs';
    const createdTab = dockStore.openApp(appId, { forceNew: true });
    if (!createdTab) return;
    await handleCreateNewGoogleFile(createdTab, kind);
  }

  async function handleGoogleTabSubmit(event: SubmitEvent, tab: DockTab) {
    event.preventDefault();
    const rawUrl = (googleUrlDrafts[tab.id] ?? '').trim();
    const rawTitle = (googleTitleDrafts[tab.id] ?? '').trim();
    const mode = googleModeDrafts[tab.id] ?? tab.googleMode ?? 'edit';
    const saveToLib = Boolean(googleSaveToLibDrafts[tab.id]);

    if (!rawUrl) {
      onToast?.('Hãy dán liên kết Google Docs hoặc Google Sheets.');
      return;
    }

    const ok = dockStore.updateTabUrl(tab.id, rawUrl, {
      title: rawTitle || undefined,
      googleMode: mode,
    });
    if (!ok) return;

    if (saveToLib) {
      try {
        const fallbackTitle = tab.appId === 'google-sheets' ? 'Bảng tính Google Sheets' : 'Tài liệu Google Docs';
        await dockStore.saveToLibrary(rawTitle || fallbackTitle, rawUrl);
        onToast?.('Đã lưu tài liệu vào Thư viện.');
      } catch (error) {
        onToast?.(`Đã mở tài liệu, nhưng chưa lưu được vào Thư viện: ${(error as Error).message}`);
      }
    }

    googleUrlDrafts = { ...googleUrlDrafts, [tab.id]: '' };
  }

  async function handleCalendarTabSubmit(event: SubmitEvent, tab: DockTab) {
    event.preventDefault();
    const raw = (calendarDrafts[tab.id] ?? '').trim();
    const extracted = extractCalendarEmbedUrl(raw);
    if (!extracted) {
      onToast?.('Liên kết phải là URL nhúng https://calendar.google.com/calendar/embed?src=… hoặc mã <iframe> của Google Calendar.');
      return;
    }

    const ok = dockStore.updateTabUrl(tab.id, extracted);
    if (!ok) return;

    if (calendarSaveToVault) {
      try {
        await saveOwnerVault({ calendarEmbedUrl: extracted });
        onToast?.('Đã lưu liên kết Google Calendar vào Firestore Vault.');
      } catch (error) {
        onToast?.(`Đã mở lịch, nhưng chưa lưu được vào Vault: ${(error as Error).message}`);
      }
    }
  }

  function openLibraryDocIntoTab(tab: DockTab, item: LibraryDockInput) {
    if (!item.url) return;
    const mode = googleModeDrafts[tab.id] ?? tab.googleMode ?? 'edit';
    dockStore.updateTabUrl(tab.id, item.url, { title: item.title, googleMode: mode });
  }

  function handleLauncherCustomSubmit(event: SubmitEvent) {
    event.preventDefault();
    const created = dockStore.openCustomUrl(launcherUrl, launcherTitle);
    if (!created) return;
    launcherUrl = '';
    launcherTitle = '';
  }

  function handleTabAuxClick(event: MouseEvent, tabId: string) {
    if (event.button === 1) {
      event.preventDefault();
      dockStore.closeTab(tabId);
    }
  }
</script>

<div class="dock-shell" class:dragging={dockStore.dragging}>
  <header class="dock-tabbar">
    <div class="dock-tab-strip" role="tablist" aria-label="Các tab ứng dụng đang mở">
      {#each dockStore.tabs as tab (tab.id)}
        <div
          class="dock-tab"
          class:active={tab.id === dockStore.activeTabId}
          role="presentation"
        >
          <button
            type="button"
            role="tab"
            class="dock-tab-select"
            aria-selected={tab.id === dockStore.activeTabId}
            title={tab.title}
            onclick={() => dockStore.selectTab(tab.id)}
            onauxclick={(event) => handleTabAuxClick(event, tab.id)}
          >
            <span class="dock-tab-icon" aria-hidden="true">{tab.icon}</span>
            <span class="dock-tab-label">{tab.title}</span>
          </button>
          <button
            type="button"
            class="dock-tab-close"
            aria-label={`Đóng tab ${tab.title}`}
            title="Đóng tab"
            onclick={() => dockStore.closeTab(tab.id)}
          >
            ×
          </button>
        </div>
      {/each}
    </div>

    <div class="dock-controls">
      <button
        type="button"
        class="dock-ctrl-btn"
        class:active={dockStore.launcherOpen}
        aria-label="Mở thêm tab ứng dụng"
        aria-expanded={dockStore.launcherOpen}
        title="Mở thêm tab (+)"
        onclick={() => dockStore.toggleLauncher()}
      >
        +
      </button>
      <button
        type="button"
        class="dock-ctrl-btn"
        class:active={dockStore.expanded}
        aria-label={dockStore.expanded ? 'Thu về chế độ chia đôi' : 'Phóng to khung ứng dụng'}
        aria-pressed={dockStore.expanded}
        title={dockStore.expanded ? 'Thu về chia đôi' : 'Phóng to toàn vùng làm việc'}
        onclick={() => dockStore.toggleExpand()}
      >
        {dockStore.expanded ? '⤡' : '⤢'}
      </button>
      <button
        type="button"
        class="dock-ctrl-btn"
        aria-label="Đóng khung ứng dụng"
        title="Đóng khung phải (giữ lại các tab)"
        onclick={() => dockStore.setOpen(false)}
      >
        ×
      </button>
    </div>

    {#if dockStore.launcherOpen}
      <div class="dock-launcher" role="dialog" aria-label="Mở ứng dụng mới">
        <div class="dock-launcher-head">
          <strong>Mở tab mới</strong>
          <button
            type="button"
            class="dock-ctrl-btn"
            aria-label="Đóng danh sách ứng dụng"
            onclick={() => { dockStore.launcherOpen = false; }}
          >
            ×
          </button>
        </div>

        <div class="dock-launcher-body">
          {#each APP_CATEGORIES as category (category.id)}
            <div class="dock-launcher-group">
              <div class="dock-launcher-label">{category.label}</div>
              <div class="dock-launcher-grid">
                {#each APP_CATALOG.filter((a) => a.category === category.id) as app (app.id)}
                  <button
                    type="button"
                    class="dock-launcher-chip"
                    onclick={() => dockStore.openApp(app.id, { forceNew: true })}
                  >
                    <span class="dock-chip-icon" aria-hidden="true">{app.icon}</span>
                    <span>{app.shortName}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/each}

          {#if dockableLibraryItems().length > 0}
            <div class="dock-launcher-group">
              <div class="dock-launcher-label">Từ Thư viện</div>
              <div class="dock-launcher-lib">
                {#each dockableLibraryItems().slice(0, 6) as item (item.id)}
                  <button
                    type="button"
                    class="dock-launcher-lib-item"
                    onclick={() => dockStore.openLibraryItem(item)}
                  >
                    <strong>{item.title}</strong>
                    <small>{item.sourceLabel ?? item.type}</small>
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          <form class="dock-launcher-url" onsubmit={handleLauncherCustomSubmit}>
            <div class="dock-launcher-label">Hoặc mở liên kết bất kỳ</div>
            <input
              class="dock-input"
              type="text"
              placeholder="Tên tab (tùy chọn)"
              bind:value={launcherTitle}
            />
            <div class="dock-url-row">
              <input
                class="dock-input"
                type="url"
                required
                placeholder="https://… (Docs, Sheets, web app…)"
                bind:value={launcherUrl}
              />
              <button type="submit" class="dock-primary-btn">Mở</button>
            </div>
          </form>
        </div>
      </div>
    {/if}
  </header>

  {#if activeTab && activeTab.kind !== 'native-app' && activeTab.url}
    <div class="dock-subbar">
      <div class="dock-subbar-meta">
        <span class="dock-subbar-title">{activeTab.title}</span>
        {#if hostLabel(activeTab.url)}
          <span class="dock-subbar-host">{hostLabel(activeTab.url)}</span>
        {/if}
      </div>
      <div class="dock-subbar-actions">
        {#if activeTab.googleMode}
          <div class="dock-mode-pills" role="group" aria-label="Chế độ nhúng Google">
            <button
              type="button"
              class="dock-mode-pill"
              class:selected={activeTab.googleMode === 'edit'}
              onclick={() => dockStore.setGoogleMode(activeTab.id, 'edit')}
            >
              Chỉnh sửa
            </button>
            <button
              type="button"
              class="dock-mode-pill"
              class:selected={activeTab.googleMode === 'preview'}
              onclick={() => dockStore.setGoogleMode(activeTab.id, 'preview')}
            >
              Xem trước
            </button>
          </div>
        {/if}

        {#if activeApp && (activeApp.kind === 'google-doc' || activeApp.kind === 'google-sheet')}
          <button
            type="button"
            class="dock-sub-btn"
            disabled={creatingTabId !== null}
            onclick={() => handleQuickNewGoogleTab(activeApp.kind === 'google-sheet' ? 'spreadsheets' : 'document')}
          >
            ＋ File mới
          </button>
        {/if}

        {#if activeApp && (activeApp.kind === 'google-doc' || activeApp.kind === 'google-sheet' || activeApp.kind === 'google-calendar')}
          <button
            type="button"
            class="dock-sub-btn"
            onclick={() => dockStore.clearTabUrl(activeTab.id)}
          >
            {activeApp.kind === 'google-calendar' ? 'Đổi lịch' : 'Đổi file'}
          </button>
        {/if}

        <button
          type="button"
          class="dock-sub-btn"
          title="Tải lại tab này"
          aria-label="Tải lại tab này"
          onclick={() => dockStore.reloadTab(activeTab.id)}
        >
          ↻
        </button>

        {#if activeTab.sourceUrl || activeTab.url}
          <a
            class="dock-sub-btn"
            href={activeTab.sourceUrl ?? activeTab.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Mở ở tab trình duyệt mới"
          >
            Mở ngoài ↗
          </a>
        {/if}
      </div>
    </div>
  {/if}

  <div class="dock-viewport">
    {#if dockStore.tabs.length === 0}
      <div class="dock-empty">
        <h2>Chọn ứng dụng để mở ở khung phải</h2>
        <p>Bạn có thể mở nhiều tab song song — chuyển qua lại mà không mất đồ thị, code hay tài liệu đang làm dở.</p>
        <div class="dock-empty-grid">
          {#each APP_CATALOG as app (app.id)}
            <button
              type="button"
              class="dock-empty-card"
              onclick={() => dockStore.openApp(app.id)}
            >
              <span class="dock-empty-icon" aria-hidden="true">{app.icon}</span>
              <strong>{app.name}</strong>
              <small>{app.description}</small>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      {#each dockStore.tabs as tab (tab.id)}
        {@const app = tab.appId ? findAppDefinition(tab.appId) : undefined}
        {@const isActive = tab.id === dockStore.activeTabId}
        <div
          class="dock-panel"
          class:active={isActive}
          role="tabpanel"
          aria-hidden={!isActive}
        >
          {#if tab.kind === 'native-app' && tab.nativeAppId === 'theon'}
            {#if dockStore.isHydrated(tab.id)}
              <TheonStage active={isActive && dockStore.open} />
            {:else}
              <div class="dock-dormant">
                <p>Theon đang chờ kích hoạt…</p>
              </div>
            {/if}
          {:else if tab.kind === 'native-app' && tab.nativeAppId === 'exercise' && tab.exercisePayload}
            {#if dockStore.isHydrated(tab.id)}
              <ExerciseTab payload={tab.exercisePayload} />
            {:else}
              <div class="dock-dormant">
                <p>Bài tập đang chờ kích hoạt…</p>
              </div>
            {/if}
          {:else if !tab.url && app && (app.kind === 'google-doc' || app.kind === 'google-sheet')}
            {@const libDocs = matchingLibraryDocs(app.kind)}
            {@const fileKind = app.kind === 'google-sheet' ? 'spreadsheets' : 'document'}
            {@const isCreating = creatingTabId === tab.id}
            <div class="dock-setup">
              <div class="dock-setup-card">
                <div class="dock-setup-header">
                  <span class="dock-setup-icon" aria-hidden="true">{app.icon}</span>
                  <div>
                    <h3>{app.name}</h3>
                    <p>Tạo file mới trực tiếp trong tab, chọn từ Thư viện hoặc dán liên kết có sẵn.</p>
                  </div>
                </div>

                <form
                  class="dock-create-box"
                  onsubmit={(e) => { e.preventDefault(); handleCreateNewGoogleFile(tab, fileKind); }}
                >
                  <div class="dock-launcher-label">Tạo file mới ngay trong tab này</div>
                  <div class="dock-url-row">
                    <input
                      class="dock-input dock-input-white"
                      type="text"
                      placeholder={app.kind === 'google-sheet' ? 'Tên bảng tính mới (VD: Số liệu chuẩn độ)…' : 'Tên tài liệu mới (VD: Báo cáo bài 3)…'}
                      value={newFileTitleDrafts[tab.id] ?? ''}
                      oninput={(e) => {
                        newFileTitleDrafts = {
                          ...newFileTitleDrafts,
                          [tab.id]: (e.currentTarget as HTMLInputElement).value,
                        };
                      }}
                    />
                    <button type="submit" class="dock-primary-btn" disabled={isCreating}>
                      {isCreating ? 'Đang tạo…' : '＋ Tạo & mở'}
                    </button>
                  </div>
                  {#if createErrorByTab[tab.id]}
                    <p class="dock-error-note">{createErrorByTab[tab.id]}</p>
                  {/if}
                </form>

                {#if libDocs.length > 0}
                  <div class="dock-lib-pick">
                    <div class="dock-launcher-label">Mở nhanh từ Thư viện của bạn</div>
                    <div class="dock-lib-list">
                      {#each libDocs as item (item.id)}
                        <button
                          type="button"
                          class="dock-launcher-lib-item"
                          onclick={() => openLibraryDocIntoTab(tab, item)}
                        >
                          <strong>{item.title}</strong>
                          <small>{item.sourceLabel ?? 'Google Drive'}</small>
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}

                <form class="dock-setup-form" onsubmit={(e) => handleGoogleTabSubmit(e, tab)}>
                  <label class="dock-field-label" for={`gurl-${tab.id}`}>
                    Hoặc dán liên kết {app.kind === 'google-sheet' ? 'Google Sheets' : 'Google Docs'} có sẵn
                  </label>
                  <input
                    id={`gurl-${tab.id}`}
                    class="dock-input"
                    type="url"
                    required
                    placeholder={app.kind === 'google-sheet'
                      ? 'https://docs.google.com/spreadsheets/d/…/edit'
                      : 'https://docs.google.com/document/d/…/edit'}
                    value={googleUrlDrafts[tab.id] ?? ''}
                    oninput={(e) => {
                      googleUrlDrafts = { ...googleUrlDrafts, [tab.id]: (e.currentTarget as HTMLInputElement).value };
                    }}
                  />

                  <input
                    id={`gtitle-${tab.id}`}
                    class="dock-input"
                    type="text"
                    placeholder="Tên hiển thị trên tab (tùy chọn)"
                    value={googleTitleDrafts[tab.id] ?? ''}
                    oninput={(e) => {
                      googleTitleDrafts = { ...googleTitleDrafts, [tab.id]: (e.currentTarget as HTMLInputElement).value };
                    }}
                  />

                  <div class="dock-setup-options">
                    <div class="dock-mode-pills">
                      <button
                        type="button"
                        class="dock-mode-pill"
                        class:selected={(googleModeDrafts[tab.id] ?? 'edit') === 'edit'}
                        onclick={() => { googleModeDrafts = { ...googleModeDrafts, [tab.id]: 'edit' }; }}
                      >
                        Chỉnh sửa trực tiếp
                      </button>
                      <button
                        type="button"
                        class="dock-mode-pill"
                        class:selected={(googleModeDrafts[tab.id] ?? 'edit') === 'preview'}
                        onclick={() => { googleModeDrafts = { ...googleModeDrafts, [tab.id]: 'preview' }; }}
                      >
                        Chỉ xem (Preview)
                      </button>
                    </div>

                    <label class="dock-checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean(googleSaveToLibDrafts[tab.id])}
                        onchange={(e) => {
                          googleSaveToLibDrafts = {
                            ...googleSaveToLibDrafts,
                            [tab.id]: (e.currentTarget as HTMLInputElement).checked,
                          };
                        }}
                      />
                      <span>Lưu vào Thư viện</span>
                    </label>
                  </div>

                  <div class="dock-setup-actions">
                    <button type="submit" class="dock-primary-btn">Mở liên kết này</button>
                    {#if app.externalCreateUrl}
                      <a
                        class="dock-sub-btn"
                        href={app.externalCreateUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Mở {app.kind === 'google-sheet' ? 'sheets.new' : 'docs.new'} ↗
                      </a>
                    {/if}
                  </div>
                </form>
              </div>
            </div>
          {:else if !tab.url && app?.kind === 'google-calendar'}
            <div class="dock-setup">
              <div class="dock-setup-card">
                <div class="dock-setup-header">
                  <span class="dock-setup-icon" aria-hidden="true">{app.icon}</span>
                  <div>
                    <h3>Google Calendar</h3>
                    <p>Dán URL nhúng lịch (hoặc mã &lt;iframe&gt;) từ Cài đặt Google Calendar → Tích hợp lịch.</p>
                  </div>
                </div>

                <form class="dock-setup-form" onsubmit={(e) => handleCalendarTabSubmit(e, tab)}>
                  <label class="dock-field-label" for={`cal-${tab.id}`}>
                    URL nhúng Google Calendar
                  </label>
                  <input
                    id={`cal-${tab.id}`}
                    class="dock-input"
                    type="text"
                    required
                    placeholder="https://calendar.google.com/calendar/embed?src=…"
                    value={calendarDrafts[tab.id] ?? ''}
                    oninput={(e) => {
                      calendarDrafts = { ...calendarDrafts, [tab.id]: (e.currentTarget as HTMLInputElement).value };
                    }}
                  />

                  <label class="dock-checkbox">
                    <input type="checkbox" bind:checked={calendarSaveToVault} />
                    <span>Lưu vào Firestore Vault (tự mở cho các lần sau)</span>
                  </label>

                  <div class="dock-setup-actions">
                    <button type="submit" class="dock-primary-btn">Mở Google Calendar</button>
                    <a
                      class="dock-sub-btn"
                      href="https://calendar.google.com"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Mở Google Calendar ↗
                    </a>
                  </div>
                </form>

                <p class="dock-setup-note">
                  Google Calendar chỉ cho nhúng chế độ xem (<code>/calendar/embed</code>). Để tạo/sửa sự kiện, bấm <strong>Mở ngoài ↗</strong>.
                </p>
              </div>
            </div>
          {:else if dockStore.isHydrated(tab.id)}
            {#key tab.reloadNonce ?? 0}
              <iframe
                class="dock-iframe"
                src={tab.url}
                title={tab.title}
                sandbox={tab.sandbox}
                allow={tab.allow}
                referrerpolicy="no-referrer"
              ></iframe>
            {/key}
          {:else}
            <div class="dock-dormant">
              <p>Tab đang chờ kích hoạt…</p>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .dock-shell {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border-radius: 0;
    background: var(--surface-card);
    overflow: hidden;
  }

  .dock-shell.dragging .dock-iframe {
    pointer-events: none;
  }

  .dock-tabbar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px 6px 8px;
    background: var(--surface-elevated);
    min-height: 44px;
    flex: 0 0 auto;
  }

  .dock-tab-strip {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .dock-tab-strip::-webkit-scrollbar {
    display: none;
  }

  .dock-tab {
    display: inline-flex;
    align-items: center;
    max-width: 190px;
    min-width: 82px;
    flex: 0 1 auto;
    border-radius: 12px;
    background: transparent;
    color: var(--text-secondary);
    transition: background 0.16s ease, color 0.16s ease;
  }

  .dock-tab:hover {
    background: rgb(255 255 255 / 55%);
    color: var(--text-primary);
  }

  .dock-tab.active {
    background: #fff;
    color: var(--text-primary);
    box-shadow: 0 1px 6px rgb(31 48 78 / 6%);
  }

  .dock-tab-select {
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    padding: 6px 4px 6px 10px;
    font-size: 12px;
    font-weight: 500;
    text-align: left;
  }

  .dock-tab-icon {
    flex: 0 0 auto;
    font-size: 13px;
    color: var(--accent-solid);
  }

  .dock-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dock-tab-close {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    margin-right: 4px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1;
    display: grid;
    place-items: center;
  }

  .dock-tab-close:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .dock-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 0 0 auto;
  }

  .dock-ctrl-btn {
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    font-size: 16px;
    display: grid;
    place-items: center;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .dock-ctrl-btn:hover {
    background: rgb(255 255 255 / 72%);
    color: var(--text-primary);
  }

  .dock-ctrl-btn.active {
    background: #d7e5fb;
    color: #174ea6;
  }

  .dock-launcher {
    position: absolute;
    top: calc(100% + 6px);
    right: 10px;
    z-index: 25;
    width: min(360px, calc(100% - 20px));
    max-height: min(72vh, 520px);
    display: flex;
    flex-direction: column;
    border-radius: 20px;
    background: #fff;
    box-shadow: var(--shadow-float);
    overflow: hidden;
  }

  .dock-launcher-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 8px;
    font-size: 13px;
  }

  .dock-launcher-body {
    overflow-y: auto;
    padding: 0 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .dock-launcher-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 6px;
  }

  .dock-launcher-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .dock-launcher-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-card);
    color: var(--text-primary);
    font-size: 12px;
    padding: 7px 11px;
  }

  .dock-launcher-chip:hover {
    background: var(--surface-hover);
  }

  .dock-chip-icon {
    color: var(--accent-solid);
  }

  .dock-launcher-lib,
  .dock-lib-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .dock-launcher-lib-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    text-align: left;
    border: 0;
    border-radius: 12px;
    background: var(--surface-card);
    padding: 8px 10px;
  }

  .dock-launcher-lib-item:hover {
    background: var(--surface-hover);
  }

  .dock-launcher-lib-item strong {
    font-size: 12px;
    font-weight: 550;
  }

  .dock-launcher-lib-item small {
    font-size: 11px;
    color: var(--text-muted);
  }

  .dock-launcher-url {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .dock-url-row {
    display: flex;
    gap: 6px;
  }

  .dock-subbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 10px;
    background: var(--surface-card);
    flex: 0 0 auto;
    flex-wrap: wrap;
  }

  .dock-subbar-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .dock-subbar-title {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dock-subbar-host {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--surface-elevated);
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }

  .dock-subbar-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .dock-mode-pills {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
  }

  .dock-mode-pill {
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text-secondary);
    font-size: 11px;
    padding: 4px 9px;
  }

  .dock-mode-pill.selected {
    background: #fff;
    color: var(--text-primary);
    font-weight: 550;
  }

  .dock-sub-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 11px;
    padding: 5px 10px;
    white-space: nowrap;
  }

  .dock-sub-btn:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .dock-sub-btn:disabled,
  .dock-primary-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .dock-primary-btn {
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--accent-solid);
    color: #fff;
    font-size: 12px;
    font-weight: 550;
    padding: 8px 16px;
    white-space: nowrap;
  }

  .dock-primary-btn:hover:not(:disabled) {
    filter: brightness(0.95);
  }

  .dock-input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    border-radius: 14px;
    background: var(--surface-elevated);
    color: var(--text-primary);
    padding: 10px 12px;
    font-size: 13px;
  }

  .dock-input-white {
    background: #fff;
  }

  .dock-input:focus-visible {
    box-shadow: 0 0 0 3px rgb(26 115 232 / 18%);
  }

  .dock-viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    background: #fff;
  }

  /* Keep-alive panels: preserve layout dimensions for canvas/WASM apps (Desmos, Ketcher, JupyterLite) */
  .dock-panel {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    visibility: hidden;
    opacity: 0;
    z-index: 1;
    pointer-events: none;
  }

  .dock-panel.active {
    visibility: visible;
    opacity: 1;
    z-index: 2;
    pointer-events: auto;
  }

  .dock-iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: #fff;
  }

  .dock-dormant {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--text-muted);
    font-size: 13px;
  }

  .dock-empty {
    height: 100%;
    overflow-y: auto;
    padding: 28px 22px;
    background: var(--surface-card);
  }

  .dock-empty h2 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 600;
  }

  .dock-empty p {
    margin: 0 0 18px;
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .dock-empty-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 10px;
  }

  .dock-empty-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    text-align: left;
    border: 0;
    border-radius: 18px;
    background: #fff;
    padding: 14px;
    transition: background 0.16s ease, transform 0.16s ease;
  }

  .dock-empty-card:hover {
    background: var(--surface-elevated);
  }

  .dock-empty-icon {
    width: 30px;
    height: 30px;
    border-radius: 10px;
    background: var(--surface-card);
    color: var(--accent-solid);
    display: grid;
    place-items: center;
    font-size: 16px;
  }

  .dock-empty-card strong {
    font-size: 13px;
    font-weight: 600;
  }

  .dock-empty-card small {
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-muted);
  }

  .dock-setup {
    height: 100%;
    overflow-y: auto;
    padding: 24px 20px;
    background: var(--surface-card);
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }

  .dock-setup-card {
    width: min(520px, 100%);
    border-radius: 22px;
    background: #fff;
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .dock-setup-header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .dock-setup-icon {
    flex: 0 0 38px;
    width: 38px;
    height: 38px;
    border-radius: 12px;
    background: var(--surface-card);
    color: var(--accent-solid);
    display: grid;
    place-items: center;
    font-size: 20px;
  }

  .dock-setup-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .dock-setup-header p {
    margin: 4px 0 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .dock-create-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    border-radius: 16px;
    background: var(--surface-card);
  }

  .dock-error-note {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--error);
  }

  .dock-setup-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .dock-field-label {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-secondary);
  }

  .dock-setup-options {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
  }

  .dock-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .dock-checkbox input {
    accent-color: var(--accent-solid);
  }

  .dock-setup-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }

  .dock-lib-pick {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .dock-setup-note {
    margin: 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-muted);
  }
</style>
