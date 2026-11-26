/**
 * Svelte 5 reactive store for the right-pane Multi-Tab Workspace Dock.
 *
 * Key properties:
 * - Persists open tabs, active tab, split ratio, and open/expanded state to localStorage.
 * - Lazy Hydration: on reload only the active visible tab mounts its <iframe>;
 *   other restored tabs stay dormant until clicked, then stay alive (keep-alive) until closed.
 * - Syncs active dock tab metadata to contextBus so Quick Chat / AI Agent can reference it.
 */
import { updateContext } from '../../core/contextBus.js';
import { getCachedVault } from '../../core/secretsVault';
import {
  buildLibraryDockSpec,
  clampSplitRatio,
  detectGoogleService,
  EXTERNAL_APP_SANDBOX,
  extractCalendarEmbedUrl,
  findAppDefinition,
  isAllowedAppUrl,
  normalizeGoogleEmbedUrl,
  parsePersistedDockState,
  resolveAppUrl,
  type DockTab,
  type GoogleEmbedMode,
  type LibraryDockInput,
  type PersistedDockState,
} from './appCatalog';

export const DOCK_STORAGE_KEY = 'theolab:workspace-dock:v1';

export interface DockLayoutSnapshot {
  open: boolean;
  expanded: boolean;
  splitRatio: number;
  tabCount: number;
  activeTab: DockTab | null;
  theonOpen: boolean;
}

class DockStore {
  open = $state(false);
  expanded = $state(false);
  splitRatio = $state(0.5);
  tabs = $state<DockTab[]>([]);
  activeTabId = $state<string | null>(null);
  hydratedIds = $state<Record<string, boolean>>({});
  launcherOpen = $state(false);
  dragging = $state(false);
  libraryItems = $state<LibraryDockInput[]>([]);

  private layoutListeners = new Set<(snapshot: DockLayoutSnapshot) => void>();
  private toastListeners = new Set<(message: string) => void>();
  private libraryMutateHandler: ((input: { title: string; url: string }) => Promise<LibraryDockInput>) | null = null;

  constructor() {
    this.restoreFromStorage();
  }

  get activeTab(): DockTab | null {
    return this.tabs.find((t) => t.id === this.activeTabId) ?? this.tabs[0] ?? null;
  }

  get isTheonOpen(): boolean {
    return this.open && this.tabs.some((t) => t.kind === 'native-app' && t.nativeAppId === 'theon');
  }

  get layoutSnapshot(): DockLayoutSnapshot {
    return {
      open: this.open,
      expanded: this.expanded,
      splitRatio: this.splitRatio,
      tabCount: this.tabs.length,
      activeTab: this.activeTab,
      theonOpen: this.isTheonOpen,
    };
  }

  isHydrated(tabId: string): boolean {
    return Boolean(this.hydratedIds[tabId]);
  }

  onLayoutChange(cb: (snapshot: DockLayoutSnapshot) => void): () => void {
    this.layoutListeners.add(cb);
    cb(this.layoutSnapshot);
    return () => {
      this.layoutListeners.delete(cb);
    };
  }

  onToast(cb: (message: string) => void): () => void {
    this.toastListeners.add(cb);
    return () => {
      this.toastListeners.delete(cb);
    };
  }

  setLibraryBridge(
    items: LibraryDockInput[],
    onSaveDriveItem?: (input: { title: string; url: string }) => Promise<LibraryDockInput>,
  ) {
    this.libraryItems = [...items];
    if (onSaveDriveItem) this.libraryMutateHandler = onSaveDriveItem;
  }

  async saveToLibrary(title: string, url: string): Promise<LibraryDockInput | null> {
    if (!this.libraryMutateHandler) return null;
    const created = await this.libraryMutateHandler({ title, url });
    return created;
  }

  private emitToast(message: string) {
    this.toastListeners.forEach((cb) => cb(message));
  }

  private notifyLayout() {
    const snap = this.layoutSnapshot;
    const active = snap.activeTab;
    updateContext({
      activeDockTab: snap.open && active
        ? {
          id: active.id,
          kind: active.kind,
          appId: active.appId ?? null,
          title: active.title,
          url: active.sourceUrl ?? active.url,
        }
        : null,
    });
    this.layoutListeners.forEach((cb) => cb(snap));
  }

  private persist() {
    try {
      const payload: PersistedDockState = {
        version: 1,
        open: this.open,
        expanded: this.expanded,
        splitRatio: this.splitRatio,
        activeTabId: this.activeTabId,
        tabs: this.tabs.map(({ reloadNonce: _nonce, ...rest }) => rest),
      };
      localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota or private-mode failures.
    }
  }

  private hydrateActive() {
    if (!this.open) return;
    const active = this.activeTab;
    if (!active) return;
    if (!this.hydratedIds[active.id]) {
      this.hydratedIds = { ...this.hydratedIds, [active.id]: true };
    }
  }

  private restoreFromStorage() {
    if (typeof localStorage === 'undefined') return;
    const parsed = parsePersistedDockState(localStorage.getItem(DOCK_STORAGE_KEY));
    if (!parsed) return;
    this.tabs = parsed.tabs;
    this.activeTabId = parsed.activeTabId;
    this.splitRatio = parsed.splitRatio;
    this.open = parsed.open;
    this.expanded = parsed.expanded;
    // Lazy hydration: only hydrate the single active tab if dock starts open.
    this.hydratedIds = {};
    this.hydrateActive();
  }

  refreshVaultUrls() {
    const vault = getCachedVault();
    let changed = false;
    this.tabs = this.tabs.map((tab) => {
      if (!tab.appId) return tab;
      const app = findAppDefinition(tab.appId);
      if (!app?.vaultOverrideKey) return tab;
      const resolved = resolveAppUrl(app, vault);
      if (resolved && resolved !== tab.url) {
        changed = true;
        return { ...tab, url: resolved, sourceUrl: resolved };
      }
      return tab;
    });
    if (changed) {
      this.persist();
      this.notifyLayout();
    }
  }

  openApp(
    appId: string,
    options: { url?: string; title?: string; googleMode?: GoogleEmbedMode; forceNew?: boolean } = {},
  ): DockTab | null {
    const app = findAppDefinition(appId);
    if (!app) {
      this.emitToast(`Không tìm thấy ứng dụng "${appId}".`);
      return null;
    }

    if (app.kind === 'native' && app.nativeAppId) {
      const existingNative = this.tabs.find(
        (tab) => tab.kind === 'native-app' && tab.nativeAppId === app.nativeAppId,
      );
      if (existingNative) {
        this.open = true;
        this.launcherOpen = false;
        this.selectTab(existingNative.id);
        return existingNative;
      }

      const tab: DockTab = {
        id: `tab-${app.id}`,
        kind: 'native-app',
        appId: app.id,
        nativeAppId: app.nativeAppId,
        title: options.title?.trim() || app.shortName,
        icon: app.icon,
        url: '',
        sandbox: '',
      };

      this.tabs = [...this.tabs, tab];
      this.activeTabId = tab.id;
      this.open = true;
      this.launcherOpen = false;
      this.hydrateActive();
      this.persist();
      this.notifyLayout();
      return tab;
    }

    // If single-instance app or already open without forceNew & no custom URL, focus existing tab.
    if (!options.forceNew && !options.url) {
      const existing = this.tabs.find((tab) => tab.appId === app.id && tab.kind === 'app');
      if (existing && !app.allowMultiple) {
        this.open = true;
        this.launcherOpen = false;
        this.selectTab(existing.id);
        return existing;
      }
      if (existing && app.kind === 'iframe') {
        this.open = true;
        this.launcherOpen = false;
        this.selectTab(existing.id);
        return existing;
      }
    }

    const vault = getCachedVault();
    let resolvedUrl = resolveAppUrl(app, vault);
    let sourceUrl = app.externalHomeUrl ?? (resolvedUrl || undefined);
    let googleMode: GoogleEmbedMode | undefined =
      app.kind === 'google-doc' || app.kind === 'google-sheet' ? (options.googleMode ?? 'edit') : undefined;

    if (options.url) {
      if (app.kind === 'google-doc' || app.kind === 'google-sheet') {
        const normalized = normalizeGoogleEmbedUrl(options.url, googleMode ?? 'edit');
        if (!normalized) {
          this.emitToast('Liên kết Google Docs/Sheets không hợp lệ.');
          return null;
        }
        resolvedUrl = normalized;
        sourceUrl = options.url;
      } else if (app.kind === 'google-calendar') {
        const extracted = extractCalendarEmbedUrl(options.url);
        if (!extracted) {
          this.emitToast('Liên kết Google Calendar phải dạng https://calendar.google.com/calendar/embed?src=…');
          return null;
        }
        resolvedUrl = extracted;
        sourceUrl = app.externalHomeUrl;
      } else if (isAllowedAppUrl(options.url)) {
        resolvedUrl = options.url;
        sourceUrl = options.url;
      }
    }

    const sameAppCount = this.tabs.filter((t) => t.appId === app.id).length;
    const defaultTitle = sameAppCount > 0 ? `${app.shortName} ${sameAppCount + 1}` : app.shortName;

    const tab: DockTab = {
      id: `tab-${app.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'app',
      appId: app.id,
      title: options.title?.trim() || defaultTitle,
      icon: app.icon,
      url: resolvedUrl,
      sourceUrl,
      googleMode,
      sandbox: app.sandbox,
      allow: app.allow,
    };

    this.tabs = [...this.tabs, tab];
    this.activeTabId = tab.id;
    this.open = true;
    this.launcherOpen = false;
    this.hydrateActive();
    this.persist();
    this.notifyLayout();
    return tab;
  }

  openLibraryItem(item: LibraryDockInput): DockTab | null {
    const existing = this.tabs.find((tab) => tab.libraryItemId === item.id);
    if (existing) {
      this.open = true;
      this.launcherOpen = false;
      this.selectTab(existing.id);
      return existing;
    }

    const spec = buildLibraryDockSpec(item, import.meta.env.BASE_URL ?? '/');
    if (!spec) {
      this.emitToast(`"${item.title}" chưa hỗ trợ mở trực tiếp trong khung phải.`);
      return null;
    }

    const tab: DockTab = {
      id: `tab-lib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'library-doc',
      libraryItemId: item.id,
      appId: spec.appId,
      title: spec.title,
      icon: spec.icon,
      url: spec.url,
      sourceUrl: spec.sourceUrl,
      googleMode: spec.googleMode,
      sandbox: spec.sandbox,
      allow: spec.allow,
    };

    this.tabs = [...this.tabs, tab];
    this.activeTabId = tab.id;
    this.open = true;
    this.launcherOpen = false;
    this.hydrateActive();
    this.persist();
    this.notifyLayout();
    return tab;
  }

  openCustomUrl(rawUrl: string, customTitle?: string): DockTab | null {
    const trimmed = rawUrl.trim();
    if (!isAllowedAppUrl(trimmed)) {
      this.emitToast('Chỉ chấp nhận liên kết https:// (hoặc http://localhost để tự host).');
      return null;
    }

    const googleService = detectGoogleService(trimmed);
    let embedUrl = trimmed;
    let icon = '↗';
    let appId: string | undefined;
    let googleMode: GoogleEmbedMode | undefined;

    if (googleService) {
      const mode: GoogleEmbedMode = googleService === 'document' || googleService === 'spreadsheets' ? 'edit' : 'preview';
      const normalized = normalizeGoogleEmbedUrl(trimmed, mode);
      if (normalized) {
        embedUrl = normalized;
        googleMode = mode;
        icon = googleService === 'spreadsheets' ? '▦' : googleService === 'document' ? '▤' : '▣';
        appId = googleService === 'spreadsheets' ? 'google-sheets' : googleService === 'document' ? 'google-docs' : undefined;
      }
    } else {
      const cal = extractCalendarEmbedUrl(trimmed);
      if (cal) {
        embedUrl = cal;
        icon = '◷';
        appId = 'google-calendar';
      }
    }

    let derivedTitle = customTitle?.trim();
    if (!derivedTitle) {
      try {
        derivedTitle = new URL(trimmed).hostname.replace(/^www\./, '');
      } catch {
        derivedTitle = 'Ứng dụng web';
      }
    }

    const tab: DockTab = {
      id: `tab-url-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'custom-url',
      appId,
      title: derivedTitle.slice(0, 64),
      icon,
      url: embedUrl,
      sourceUrl: trimmed,
      googleMode,
      sandbox: EXTERNAL_APP_SANDBOX,
      allow: 'clipboard-read; clipboard-write; fullscreen',
    };

    this.tabs = [...this.tabs, tab];
    this.activeTabId = tab.id;
    this.open = true;
    this.launcherOpen = false;
    this.hydrateActive();
    this.persist();
    this.notifyLayout();
    return tab;
  }

  updateTabUrl(
    tabId: string,
    rawUrl: string,
    options: { title?: string; googleMode?: GoogleEmbedMode } = {},
  ): boolean {
    const target = this.tabs.find((t) => t.id === tabId);
    if (!target) return false;
    const app = target.appId ? findAppDefinition(target.appId) : undefined;

    let nextUrl = '';
    let nextSource = rawUrl.trim();
    let nextMode = options.googleMode ?? target.googleMode;

    if (app?.kind === 'google-calendar') {
      const extracted = extractCalendarEmbedUrl(rawUrl);
      if (!extracted) {
        this.emitToast('Hãy dán URL nhúng https://calendar.google.com/calendar/embed?src=… (hoặc mã iframe nhúng).');
        return false;
      }
      nextUrl = extracted;
      nextSource = 'https://calendar.google.com';
    } else if (app?.kind === 'google-doc' || app?.kind === 'google-sheet' || detectGoogleService(rawUrl)) {
      const mode: GoogleEmbedMode = nextMode ?? 'edit';
      const normalized = normalizeGoogleEmbedUrl(rawUrl, mode);
      if (!normalized) {
        this.emitToast('Liên kết Google Docs/Sheets/Drive không hợp lệ.');
        return false;
      }
      nextUrl = normalized;
      nextMode = mode;
    } else if (isAllowedAppUrl(rawUrl)) {
      nextUrl = rawUrl.trim();
    } else {
      this.emitToast('Chỉ chấp nhận liên kết https:// (hoặc http://localhost).');
      return false;
    }

    this.tabs = this.tabs.map((tab) =>
      tab.id === tabId
        ? {
          ...tab,
          url: nextUrl,
          sourceUrl: nextSource,
          googleMode: nextMode,
          title: options.title?.trim() || tab.title,
          reloadNonce: (tab.reloadNonce ?? 0) + 1,
        }
        : tab,
    );
    this.hydratedIds = { ...this.hydratedIds, [tabId]: true };
    this.persist();
    this.notifyLayout();
    return true;
  }

  clearTabUrl(tabId: string) {
    this.tabs = this.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, url: '', reloadNonce: (tab.reloadNonce ?? 0) + 1 } : tab,
    );
    this.persist();
    this.notifyLayout();
  }

  setGoogleMode(tabId: string, mode: GoogleEmbedMode) {
    const target = this.tabs.find((t) => t.id === tabId);
    if (!target) return;
    const raw = target.sourceUrl || target.url;
    if (!raw) return;
    const normalized = normalizeGoogleEmbedUrl(raw, mode);
    if (!normalized) return;
    this.tabs = this.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, url: normalized, googleMode: mode } : tab,
    );
    this.persist();
    this.notifyLayout();
  }

  selectTab(tabId: string) {
    if (!this.tabs.some((t) => t.id === tabId)) return;
    this.activeTabId = tabId;
    this.launcherOpen = false;
    this.hydrateActive();
    this.persist();
    this.notifyLayout();
  }

  closeTab(tabId: string) {
    const index = this.tabs.findIndex((t) => t.id === tabId);
    if (index < 0) return;

    const nextTabs = this.tabs.filter((t) => t.id !== tabId);
    const nextHydrated = { ...this.hydratedIds };
    delete nextHydrated[tabId];
    this.hydratedIds = nextHydrated;
    this.tabs = nextTabs;

    if (!nextTabs.length) {
      this.activeTabId = null;
      this.open = false;
      this.expanded = false;
      this.launcherOpen = false;
    } else if (this.activeTabId === tabId) {
      const fallback = nextTabs[Math.min(index, nextTabs.length - 1)] ?? nextTabs[0]!;
      this.activeTabId = fallback.id;
      this.hydrateActive();
    }
    this.persist();
    this.notifyLayout();
  }

  reloadTab(tabId: string) {
    this.tabs = this.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, reloadNonce: (tab.reloadNonce ?? 0) + 1 } : tab,
    );
  }

  setOpen(nextOpen: boolean) {
    this.open = nextOpen;
    if (!nextOpen) {
      this.expanded = false;
      this.launcherOpen = false;
    } else {
      if (!this.tabs.length) {
        this.launcherOpen = true;
      } else {
        if (!this.activeTabId) this.activeTabId = this.tabs[0]?.id ?? null;
        this.hydrateActive();
      }
    }
    this.persist();
    this.notifyLayout();
  }

  toggleOpen() {
    this.setOpen(!this.open);
  }

  toggleExpand() {
    if (!this.open) return;
    this.expanded = !this.expanded;
    this.persist();
    this.notifyLayout();
  }

  setExpanded(nextExpanded: boolean) {
    if (!this.open && nextExpanded) return;
    if (this.expanded === nextExpanded) return;
    this.expanded = nextExpanded;
    this.persist();
    this.notifyLayout();
  }

  setSplitRatio(ratio: number) {
    const clamped = clampSplitRatio(ratio);
    if (Math.abs(clamped - this.splitRatio) < 0.001) return;
    this.splitRatio = clamped;
    this.persist();
    this.notifyLayout();
  }

  setDragging(active: boolean) {
    this.dragging = active;
  }

  toggleLauncher() {
    this.launcherOpen = !this.launcherOpen;
  }

  setTheonOpen(nextOpen: boolean) {
    if (nextOpen) {
      this.openApp('theon');
      return;
    }
    const theonTab = this.tabs.find((t) => t.kind === 'native-app' && t.nativeAppId === 'theon');
    if (theonTab) {
      this.closeTab(theonTab.id);
    }
  }

  toggleTheon() {
    this.setTheonOpen(!this.isTheonOpen);
  }

  openExerciseTab(payload: import('../theon/exerciseSchema').ExerciseTabPayload): DockTab {
    const tab: DockTab = {
      id: `tab-exercise-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'native-app',
      appId: 'exercise',
      nativeAppId: 'exercise',
      exercisePayload: payload,
      title: payload.title.slice(0, 64),
      icon: '✎',
      url: '',
      sandbox: '',
    };

    this.tabs = [...this.tabs, tab];
    this.activeTabId = tab.id;
    this.open = true;
    this.launcherOpen = false;
    this.hydrateActive();
    this.persist();
    this.notifyLayout();
    return tab;
  }
}

export const dockStore = new DockStore();
