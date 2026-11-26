<script lang="ts">
  import { APP_CATEGORIES, APP_CATALOG, type AppDefinition } from './appCatalog';
  import { dockStore } from './dockStore.svelte';

  let { onLaunched }: { onLaunched?: () => void } = $props();

  let query = $state('');
  let customOpen = $state(false);
  let customTitle = $state('');
  let customUrl = $state('');

  const filteredByCategory = $derived.by(() => {
    const q = query.trim().toLocaleLowerCase('vi');
    return APP_CATEGORIES.map((category) => ({
      category,
      apps: APP_CATALOG.filter((app) => {
        if (app.category !== category.id) return false;
        if (!q) return true;
        return `${app.name} ${app.shortName} ${app.description}`.toLocaleLowerCase('vi').includes(q);
      }),
    })).filter((group) => group.apps.length > 0);
  });

  function openCount(appId: string): number {
    return dockStore.tabs.filter((tab) => tab.appId === appId).length;
  }

  function launchApp(app: AppDefinition, forceNew = false) {
    dockStore.openApp(app.id, { forceNew });
    onLaunched?.();
  }

  function focusTab(tabId: string) {
    dockStore.setOpen(true);
    dockStore.selectTab(tabId);
    onLaunched?.();
  }

  function handleCustomSubmit(event: SubmitEvent) {
    event.preventDefault();
    const created = dockStore.openCustomUrl(customUrl, customTitle);
    if (!created) return;
    customTitle = '';
    customUrl = '';
    customOpen = false;
    onLaunched?.();
  }
</script>

<div class="apps-drawer">
  <input
    class="search-input apps-search"
    type="search"
    placeholder="Tìm ứng dụng (Docs, Desmos, Ketcher…)"
    aria-label="Tìm ứng dụng"
    bind:value={query}
  />

  {#if dockStore.tabs.length > 0}
    <div class="apps-open-section">
      <div class="apps-section-header">
        <h2 class="drawer-section-title">Đang mở ({dockStore.tabs.length})</h2>
        {#if !dockStore.open}
          <button
            type="button"
            class="apps-mini-action"
            onclick={() => { dockStore.setOpen(true); onLaunched?.(); }}
          >
            Hiện khung phải
          </button>
        {/if}
      </div>
      <div class="apps-open-pills">
        {#each dockStore.tabs as tab (tab.id)}
          <div class="apps-open-row" class:active={dockStore.open && dockStore.activeTabId === tab.id}>
            <button
              type="button"
              class="apps-open-focus"
              onclick={() => focusTab(tab.id)}
              title={tab.title}
            >
              <span class="apps-item-icon" aria-hidden="true">{tab.icon}</span>
              <span class="apps-open-title">{tab.title}</span>
            </button>
            <button
              type="button"
              class="apps-open-close"
              aria-label={`Đóng tab ${tab.title}`}
              onclick={() => dockStore.closeTab(tab.id)}
            >
              ×
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#each filteredByCategory as group (group.category.id)}
    <h2 class="drawer-section-title apps-cat-title">{group.category.label}</h2>
    <div class="apps-list">
      {#each group.apps as app (app.id)}
        {@const count = openCount(app.id)}
        <div class="apps-row">
          <button
            type="button"
            class="apps-item"
            class:opened={count > 0}
            onclick={() => launchApp(app, false)}
          >
            <span class="apps-item-icon" aria-hidden="true">{app.icon}</span>
            <span class="apps-item-copy">
              <strong>
                {app.name}
                {#if count > 0}
                  <span class="apps-count-pill">{count}</span>
                {/if}
              </strong>
              <small>{app.description}</small>
            </span>
          </button>
          {#if app.allowMultiple && count > 0}
            <button
              type="button"
              class="apps-add-instance"
              title={`Mở thêm tab ${app.shortName}`}
              aria-label={`Mở thêm tab ${app.name}`}
              onclick={() => launchApp(app, true)}
            >
              +
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/each}

  <div class="apps-custom-wrap">
    <button
      type="button"
      class="tree-item apps-custom-toggle"
      aria-expanded={customOpen}
      onclick={() => { customOpen = !customOpen; }}
    >
      ＋ Mở URL ứng dụng tùy chỉnh
    </button>
    {#if customOpen}
      <form class="apps-custom-form" onsubmit={handleCustomSubmit}>
        <input
          class="search-input"
          type="text"
          placeholder="Tên tab (tùy chọn)"
          bind:value={customTitle}
        />
        <input
          class="search-input"
          type="url"
          required
          placeholder="https://… hoặc http://localhost:…"
          bind:value={customUrl}
        />
        <button type="submit" class="button button-soft">Mở ở khung phải</button>
      </form>
    {/if}
  </div>
</div>

<style>
  .apps-drawer {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .apps-search {
    margin-bottom: 10px;
  }

  .apps-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding-right: 4px;
  }

  .apps-section-header .drawer-section-title {
    margin: 6px 8px;
  }

  .apps-mini-action {
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--accent-solid);
    font-size: 11px;
    font-weight: 550;
    padding: 4px 9px;
  }

  .apps-mini-action:hover {
    background: var(--surface-hover);
  }

  .apps-open-pills {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 6px;
  }

  .apps-open-row {
    display: flex;
    align-items: center;
    border-radius: 12px;
    background: var(--surface-card);
    padding: 2px 4px 2px 6px;
  }

  .apps-open-row.active {
    background: #dfeaff;
  }

  .apps-open-focus {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: transparent;
    padding: 6px 4px;
    text-align: left;
    font-size: 12px;
    color: var(--text-primary);
  }

  .apps-open-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .apps-open-close {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1;
  }

  .apps-open-close:hover {
    background: rgb(255 255 255 / 70%);
    color: var(--text-primary);
  }

  .apps-cat-title {
    margin: 14px 8px 6px;
  }

  .apps-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .apps-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .apps-item {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    border: 0;
    border-radius: 14px;
    background: transparent;
    padding: 9px 10px;
    text-align: left;
    transition: background 0.16s ease;
  }

  .apps-item:hover {
    background: var(--surface-elevated);
  }

  .apps-item.opened {
    background: var(--surface-card);
  }

  .apps-item-icon {
    flex: 0 0 22px;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: var(--surface-elevated);
    color: var(--accent-solid);
    font-size: 13px;
  }

  .apps-item-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .apps-item-copy strong {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 550;
    color: var(--text-primary);
  }

  .apps-item-copy small {
    font-size: 11px;
    line-height: 1.35;
    color: var(--text-muted);
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .apps-count-pill {
    display: inline-grid;
    place-items: center;
    min-width: 17px;
    height: 17px;
    padding: 0 5px;
    border-radius: var(--radius-pill);
    background: #d7e5fb;
    color: #174ea6;
    font-size: 10px;
    font-weight: 600;
  }

  .apps-add-instance {
    flex: 0 0 28px;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    font-size: 16px;
  }

  .apps-add-instance:hover {
    background: var(--surface-elevated);
    color: var(--text-primary);
  }

  .apps-custom-wrap {
    margin-top: 12px;
  }

  .apps-custom-toggle {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .apps-custom-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    margin-top: 6px;
    border-radius: 16px;
    background: var(--surface-card);
  }

  .apps-custom-form .search-input {
    margin-bottom: 0;
    background: #fff;
    padding: 10px 12px;
    font-size: 12px;
  }

  .apps-custom-form .button-soft {
    margin-top: 2px;
    background: var(--surface-elevated);
    font-size: 12px;
    padding: 9px 12px;
  }
</style>
