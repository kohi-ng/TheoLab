import './styles/app.css';
import katex from 'katex';
import sampleLesson from './mocks/sampleLesson.json';
import { APP_MODE } from './config/runtimeConfig.js';
import { NAV_TABS } from './config/navigationConfig.js';
import {
  deleteChatSession,
  listChatSessions,
  listLessons,
  loadLesson,
  saveChatSession,
  saveLesson,
} from './core/dataGateway.js';
import { getAuthState, signInWithGoogle } from './core/authGate.js';
import { getActiveContext, updateContext } from './core/contextBus.js';
import {
  listNavigationTabs,
  loadModule,
  mountWidget,
  registerModule,
  registerNavigationTabs,
} from './core/moduleRegistry.js';
import { runAgent } from './modules/agents/agentLoop.js';
import { clearMessages, mountChatComposer, renderMessage } from './modules/agents/chatUI.js';
import {
  ensureAcademyLoaded,
  mountCourseTree,
  mountUnitWorkspace,
  navigateToDeepLink,
  onAcademyEvent,
} from './modules/academy/mountAcademy.ts';
import { mountCommandPalette } from './modules/kb/mountKb.ts';
import {
  clearVaultCache,
  getCachedVault,
  isAllowedDriveUrl,
  loadOwnerVault,
  saveOwnerVault,
} from './core/secretsVault.ts';
import {
  ensureLibraryLoaded,
  libraryStore,
  mountLibraryDrawer,
  mountLibraryMain,
} from './modules/library/mountLibrary.ts';
import {
  canOpenLibraryItemInDock,
  dockStore,
  mountAppsDrawer,
  mountWorkspaceDock,
  onDockLayoutChange,
  openLibraryItemInDock,
} from './modules/apps/mountApps.ts';
import { extractCalendarEmbedUrl, isAllowedAppUrl } from './modules/apps/appCatalog.ts';
import { mountTheonSettings } from './modules/theon/mountTheon.ts';
import { aiConfigStore } from './core/aiConfigStore.svelte.ts';
import { mountAiSettings } from './modules/settings/mountAiSettings.ts';
import { fetchBoundedDriveTextForChat } from './core/googleDriveApi.ts';

const app = document.querySelector('#app');
let lesson;
let lessons = [];
let sessions = [];
let currentSession = null;
let selectedTab = 'Bài học';
let overflowExpanded = false;
let drawerOpen = false;
let workspace = 'lesson';
let workspaceComposerCleanup;
let saveQueue = Promise.resolve();
let unmountDrawerTree = null;
let unmountAcademyMain = null;
let unmountLibraryMain = null;
let unmountTheonSettings = null;
let unmountAiSettings = null;
let unmountDock = null;
let dockLayout = dockStore.layoutSnapshot;
let unitTitle = 'TheoLab';
// In firebase_auth mode no data is read or written until the owner has signed in.
let dataReady = false;
let dataLoading = false;

function requireData() {
  if (!dataReady) toast('Hãy đăng nhập Google ở nút ⚙ Cài đặt (góc dưới) và đợi tải dữ liệu.');
  return dataReady;
}

function setTitle(title) {
  document.querySelector('#current-title').textContent = title;
}

function clearAcademyMain() {
  unmountAcademyMain?.();
  unmountAcademyMain = null;
  unmountLibraryMain?.();
  unmountLibraryMain = null;
  unmountTheonSettings?.();
  unmountTheonSettings = null;
  unmountAiSettings?.();
  unmountAiSettings = null;
}

function makeDefaultPreferences(withContext = false) {
  const defaults = aiConfigStore.defaults;
  const provider = defaults.providerId;
  const model = defaults.modelId || aiConfigStore.getDefaultModelForProvider(provider)?.modelId || 'gemini-2.5-flash';
  const entry = aiConfigStore.findModel(provider, model);
  return {
    provider,
    model,
    modelLabel: entry?.label ?? model,
    skill: 'supporter',
    temperature: defaults.temperature ?? 0.3,
    maxTokens: defaults.maxTokens ?? 2048,
    systemPrompt: defaults.systemPrompt ?? '',
    depth: 'balanced',
    useRag: true,
    useMcp: false,
    instructions: '',
    autoContext: withContext,
    lessonIds: [],
    includeFormula: false,
  };
}

registerModule('lessonViewer', () => import('./modules/lessonViewer/lessonViewer.js'));
registerModule('formulaHub', () => import('./modules/formulaHub/formulaHub.js'));
registerModule('widget:formula_calc', () => import('./modules/widgets/formulaCalc.js'));
registerModule('libraryViewer', () => import('./modules/library/libraryViewer.js'));
registerModule('vectorKb', () => import('./modules/kb/mountKb.ts'));
registerNavigationTabs(NAV_TABS);

app.innerHTML = `
  <div class="app-shell" id="app-shell">
    <div class="left-workspace" id="left-workspace">
      <header class="topbar">
        <button class="icon-button menu-button" aria-label="Mở menu" data-action="drawer">☰</button>
        <h1 class="topbar-title" id="current-title">TheoLab</h1>
        <div class="topbar-actions">
          <button class="quick-button" data-action="dock" id="dock-toggle-btn" aria-pressed="false" title="Đóng / mở khung ứng dụng chia tab">◫ Ứng dụng</button>
          <button class="quick-button" data-action="formula">✦ Công thức</button>
        </div>
      </header>
      <main class="app-main" id="app-main">
        <section class="content-pane"><div class="page-content" id="page-content"></div></section>
      </main>
    </div>
    <div class="dock-splitter hidden" id="dock-splitter" role="separator" aria-orientation="vertical" aria-label="Kéo để thay đổi tỷ lệ chia khung" tabindex="0"></div>
    <section class="dock-pane hidden" id="dock-pane" aria-label="Không gian ứng dụng chia tab"></section>
  </div>
  <div class="drawer-backdrop" id="drawer-backdrop"></div>
  <aside class="drawer" id="drawer" aria-label="Điều hướng">
    <div class="drawer-header">
      <span class="brand"><span class="sparkle" aria-hidden="true">✦</span><span class="brand-name">TheoLab</span></span>
      <button class="icon-button search-button" data-action="palette" aria-label="Tìm kiếm" title="Tìm kiếm (Ctrl+K)">⌕</button>
      <button class="icon-button" data-action="drawer" aria-label="Thu gọn hoặc đóng menu" title="Thu gọn / mở menu">◧</button>
    </div>
    <button class="nav-tab new-chat" type="button" data-action="new-session" title="Phiên chat mới">
      <span class="nav-icon" aria-hidden="true">✎</span><span class="nav-label">Phiên chat mới</span>
    </button>
    <div class="drawer-scroll">
      <nav class="tab-list" aria-label="Khu vực chính">
        <div class="primary-navigation" id="primary-navigation"></div>
        <div class="overflow-navigation" id="overflow-navigation">
          <button class="nav-tab overflow-toggle" type="button" aria-expanded="false" data-action="toggle-overflow" title="Thêm">
            <span class="nav-icon" aria-hidden="true">⋯</span><span class="nav-label">Thêm</span>
          </button>
          <div class="overflow-panel" id="overflow-panel"><div class="overflow-panel-inner" id="overflow-tabs"></div></div>
        </div>
      </nav>
      <div class="drawer-view" id="drawer-view"></div>
    </div>
    <div class="theon-sidebar-row">
      <button
        class="theon-toggle-control"
        id="theon-toggle-btn"
        type="button"
        role="switch"
        aria-checked="false"
        data-action="toggle-theon"
        title="Bật / tắt Theon ở khung phải"
      >
        <span class="theon-toggle-left">
          <span class="theon-dot" aria-hidden="true"></span>
          <span class="nav-label theon-label">Theon</span>
        </span>
        <span class="theon-switch-track" aria-hidden="true">
          <span class="theon-switch-thumb"></span>
        </span>
      </button>
    </div>
    <div class="drawer-footer">
      <span class="avatar" aria-hidden="true">T</span><span class="footer-name">Không gian của tôi</span>
      <button class="icon-button" data-action="open-settings" aria-label="Mở cấu hình" title="Cấu hình">⚙</button>
    </div>
  </aside>
  <div id="toast" class="toast hidden" role="status"></div>
`;

const page = document.querySelector('#page-content');
const appMain = document.querySelector('#app-main');
const appShell = document.querySelector('#app-shell');
const drawer = document.querySelector('#drawer');
const backdrop = document.querySelector('#drawer-backdrop');
const drawerView = document.querySelector('#drawer-view');
const dockPane = document.querySelector('#dock-pane');
const dockSplitter = document.querySelector('#dock-splitter');
const dockToggleBtn = document.querySelector('#dock-toggle-btn');
const theonToggleBtn = document.querySelector('#theon-toggle-btn');

function toast(message) {
  const node = document.querySelector('#toast');
  node.textContent = message;
  node.classList.remove('hidden');
  window.setTimeout(() => node.classList.add('hidden'), 3600);
}

const mobileLayout = window.matchMedia('(max-width: 800px)');

function syncWorkspaceLayout() {
  const mobile = mobileLayout.matches;
  const dockOpen = Boolean(dockLayout.open);
  const dockExpanded = dockOpen && Boolean(dockLayout.expanded);
  const showSplitter = dockOpen && !mobile && !dockExpanded;
  const theonOpen = Boolean(dockLayout.theonOpen);

  appShell.style.setProperty('--split-left', `${(dockLayout.splitRatio * 100).toFixed(2)}%`);
  appShell.classList.toggle('dock-open', dockOpen && !mobile);
  appShell.classList.toggle('dock-expanded', dockExpanded && !mobile);
  appMain.classList.toggle('dock-open', dockOpen && !mobile);

  dockPane.classList.toggle('hidden', !dockOpen);
  dockPane.classList.toggle('mobile-open', dockOpen && mobile);
  dockSplitter.classList.toggle('hidden', !showSplitter);

  if (dockToggleBtn) {
    dockToggleBtn.textContent = dockLayout.tabCount > 0 ? `◫ ${dockLayout.tabCount} tab` : '◫ Ứng dụng';
    dockToggleBtn.classList.toggle('active', dockOpen);
    dockToggleBtn.setAttribute('aria-pressed', String(dockOpen));
  }

  if (theonToggleBtn) {
    theonToggleBtn.classList.toggle('on', theonOpen);
    theonToggleBtn.setAttribute('aria-checked', String(theonOpen));
  }
}

function initDockSplitter() {
  let activePointerId = null;

  const updateFromClientX = (clientX) => {
    const rect = appShell.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    dockStore.setSplitRatio(ratio);
  };

  dockSplitter.addEventListener('pointerdown', (event) => {
    if (mobileLayout.matches) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    dockSplitter.setPointerCapture(event.pointerId);
    document.body.classList.add('dock-resizing');
    dockStore.setDragging(true);
  });

  dockSplitter.addEventListener('pointermove', (event) => {
    if (activePointerId !== event.pointerId) return;
    updateFromClientX(event.clientX);
  });

  const endDrag = (event) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    document.body.classList.remove('dock-resizing');
    dockStore.setDragging(false);
  };

  dockSplitter.addEventListener('pointerup', endDrag);
  dockSplitter.addEventListener('pointercancel', endDrag);
  dockSplitter.addEventListener('dblclick', () => dockStore.setSplitRatio(0.5));
  dockSplitter.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      dockStore.setSplitRatio(dockLayout.splitRatio - 0.03);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      dockStore.setSplitRatio(dockLayout.splitRatio + 0.03);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      dockStore.setSplitRatio(0.5);
    }
  });
}

mobileLayout.addEventListener('change', () => syncWorkspaceLayout());

// Desktop: the sidebar is persistent and the menu button collapses it to a rail.
// Mobile: the same element is an overlay drawer.
function toggleSidebar() {
  if (mobileLayout.matches) setDrawer(!drawerOpen);
  else document.body.classList.toggle('sidebar-collapsed');
}

function setDrawer(open) {
  drawerOpen = open;
  drawer.classList.toggle('open', open);
  backdrop.classList.toggle('visible', open);
  backdrop.setAttribute('aria-hidden', String(!open));
  if (open) renderNavigation();
}

function renderNavigation() {
  const primaryRoot = document.querySelector('#primary-navigation');
  const overflowRoot = document.querySelector('#overflow-tabs');
  const overflowWrap = document.querySelector('#overflow-navigation');
  const overflowPanel = document.querySelector('#overflow-panel');
  const overflowToggle = document.querySelector('.overflow-toggle');
  if (!primaryRoot || !overflowRoot) return;
  const tabs = listNavigationTabs();
  const primary = tabs.filter((tab) => tab.primary);
  const shown = primary.slice(0, 5);
  const overflow = [...primary.slice(5), ...tabs.filter((tab) => !tab.primary)];
  const makeTabButton = (tab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `nav-tab${selectedTab === tab.label ? ' selected' : ''}`;
    button.dataset.navId = tab.id;
    button.title = tab.label;
    button.setAttribute('aria-current', selectedTab === tab.label ? 'page' : 'false');
    const icon = document.createElement('span');
    icon.className = 'nav-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = tab.icon;
    const label = document.createElement('span');
    label.className = 'nav-label';
    label.textContent = tab.label;
    button.append(icon, label);
    button.addEventListener('click', () => handleTab(tab));
    return button;
  };
  primaryRoot.replaceChildren(...shown.map(makeTabButton));
  overflowRoot.replaceChildren(...overflow.map(makeTabButton));
  overflowWrap.classList.toggle('hidden', !overflow.length);
  overflowPanel.classList.toggle('expanded', overflowExpanded && overflow.length > 0);
  overflowToggle?.setAttribute('aria-expanded', String(overflowExpanded && overflow.length > 0));
}

function safeLessonContext(value) {
  if (!value) return null;
  return {
    id: value.id,
    core: { subject: value.core?.subject ?? '' },
    payload: {
      title: value.payload?.title ?? '',
      blocks: (value.payload?.blocks ?? []).map((block) => ({
        id: block.id,
        type: block.type,
        title: block.title,
        content: block.content ?? block.prompt ?? block.question ?? block.summary ?? '',
        formula: block.formula,
        options: block.options?.map((option) => option.text),
      })),
    },
  };
}

async function buildAgentContext(preferences) {
  const active = getActiveContext();
  const explicitIds = preferences.lessonIds ?? [];
  const explicitLessons = lessons.filter((item) => explicitIds.includes(item.id));
  let activeLesson = null;
  if (preferences.autoContext && active.lessonId) {
    activeLesson = lessons.find((item) => item.id === active.lessonId)
      ?? (active.lessonId === lesson?.id ? lesson : null);
  }
  return {
    activeLesson: safeLessonContext(activeLesson),
    lessons: explicitLessons.map(safeLessonContext),
    includeFormula: Boolean(preferences.includeFormula),
    activeDockTab: preferences.autoContext && active.activeDockTab
      ? {
        title: String(active.activeDockTab.title ?? '').slice(0, 120),
        appId: active.activeDockTab.appId ? String(active.activeDockTab.appId) : null,
        kind: String(active.activeDockTab.kind ?? 'app'),
      }
      : null,
    libraryContext: preferences.libraryContext
      ? {
        id: preferences.libraryContext.id,
        title: preferences.libraryContext.title,
        type: preferences.libraryContext.type,
        sourceLabel: preferences.libraryContext.sourceLabel,
        content: String(preferences.libraryContext.content ?? '').slice(0, 16000),
        widgetState: preferences.libraryContext.widgetState
          ? {
            widgetId: String(preferences.libraryContext.widgetState.widgetId ?? ''),
            payload: preferences.libraryContext.widgetState.payload,
          }
          : null,
      }
      : null,
  };
}

function persistCurrentSession() {
  if (!currentSession) return Promise.resolve();
  const snapshot = structuredClone(currentSession);
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => saveChatSession(snapshot))
    .then((saved) => {
      if (currentSession?.id === saved.id) currentSession.updatedAt = saved.updatedAt;
      upsertSession(saved);
    })
    .catch((error) => toast(`Không thể lưu phiên chat: ${error.message}`));
  return saveQueue;
}

function upsertSession(session) {
  const index = sessions.findIndex((entry) => entry.id === session.id);
  if (index >= 0) sessions[index] = session;
  else sessions.unshift(session);
  sessions.sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
  if (selectedTab === 'AI') renderDrawerView();
}

function renderFullMessages() {
  const root = document.querySelector('#workspace-messages');
  if (!root || !currentSession) return;
  const title = document.querySelector('#workspace-title');
  if (title) title.textContent = currentSession.title;
  const modelMeta = document.querySelector('#workspace-model');
  if (modelMeta) {
    modelMeta.textContent = `${currentSession.preferences?.modelLabel ?? currentSession.preferences?.model ?? 'Chưa chọn model'} · ${currentSession.preferences?.autoContext ? 'có ngữ cảnh bài học' : 'chat độc lập'}`;
  }
  clearMessages(root);
  currentSession.messages.forEach((message) => renderMessage(root, message));
  if (!currentSession.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'ai-empty-state';
    const heading = document.createElement('h2');
    heading.textContent = 'Bạn muốn tìm hiểu điều gì?';
    const note = document.createElement('p');
    note.textContent = 'Chọn bài học, bật bám ngữ cảnh hoặc bắt đầu với một câu hỏi.';
    empty.append(heading, note);
    root.append(empty);
  }
}

function persistPreferences(preferences) {
  if (!currentSession) return;
  currentSession.preferences = { ...preferences };
  const modelMeta = document.querySelector('#workspace-model');
  if (modelMeta) {
    modelMeta.textContent = `${preferences.modelLabel ?? preferences.model ?? 'Chưa chọn model'} · ${preferences.autoContext ? 'có ngữ cảnh bài học' : 'chat độc lập'}`;
  }
  persistCurrentSession();
}

function mountFullComposer() {
  const host = document.querySelector('#workspace-composer');
  if (!host || !currentSession) return;
  workspaceComposerCleanup?.();
  workspaceComposerCleanup = mountChatComposer(host, {
    getState: () => currentSession?.preferences ?? makeDefaultPreferences(),
    onStateChange: persistPreferences,
    lessons,
    activeTitle: lesson?.payload.title,
    onSend: sendFullMessage,
  });
}

async function sendFullMessage(prompt, preferences) {
  if (!currentSession) return;
  const sessionId = currentSession.id;
  const userMessage = { id: crypto.randomUUID(), role: 'user', content: prompt, createdAt: new Date().toISOString() };
  currentSession.messages.push(userMessage);
  if (currentSession.title === 'Phiên chat mới') currentSession.title = prompt.slice(0, 48);
  renderFullMessages();
  await persistCurrentSession();
  const pending = { id: crypto.randomUUID(), role: 'assistant', content: 'Đang suy nghĩ…', createdAt: new Date().toISOString() };
  currentSession.messages.push(pending);
  renderFullMessages();
  try {
    const context = await buildAgentContext(preferences);
    const answer = await runAgent({ prompt, model: preferences.model, provider: preferences.provider, preferences, context });
    if (currentSession?.id !== sessionId) return;
    pending.content = answer;
  } catch (error) {
    if (currentSession?.id !== sessionId) return;
    pending.content = `Không thể gọi Agent: ${error.message}`;
  }
  renderFullMessages();
  await persistCurrentSession();
}

function renderAIWorkspace() {
  clearAcademyMain();
  workspace = 'ai';
  document.querySelector('.app-main').classList.remove('chat-open');
  page.innerHTML = `
    <section class="ai-workspace">
      <header class="ai-workspace-header">
        <div><h1 id="workspace-title"></h1><p id="workspace-model"></p></div>
        <button class="button button-soft" data-action="new-session">＋ Phiên chat mới</button>
      </header>
      <div class="workspace-messages chat-messages" id="workspace-messages"></div>
      <div class="composer-host full-composer" id="workspace-composer"></div>
    </section>`;
  document.querySelector('.app-shell').classList.add('ai-workspace-open');
  document.querySelector('#workspace-title').textContent = currentSession?.title ?? 'Phiên chat mới';
  document.querySelector('#workspace-model').textContent = currentSession
    ? `${currentSession.preferences?.modelLabel ?? currentSession.preferences?.model ?? 'Chưa chọn model'} · ${currentSession.preferences?.autoContext ? 'có ngữ cảnh bài học' : 'chat độc lập'}`
    : 'Chat độc lập';
  renderFullMessages();
  mountFullComposer();
  document.querySelector('.app-main').classList.add('ai-mode');
  syncWorkspaceLayout();
}

async function openSession(session) {
  currentSession = session;
  currentSession.preferences = { ...makeDefaultPreferences(), ...(session.preferences ?? {}) };
  currentSession.messages ??= [];
  selectedTab = 'AI';
  updateContext({ activeTab: 'AI', libraryContext: currentSession.preferences.libraryContext ?? null });
  renderAIWorkspace();
  renderDrawerView();
  setDrawer(false);
  document.querySelector('#current-title').textContent = 'TheoLab AI';
}

async function createSession() {
  if (!requireData()) return;
  const now = new Date().toISOString();
  const session = {
    id: crypto.randomUUID(),
    title: 'Phiên chat mới',
    createdAt: now,
    updatedAt: now,
    messages: [],
    preferences: {
      ...makeDefaultPreferences(Boolean(getActiveContext().lessonId)),
      libraryContext: null,
    },
  };
  currentSession = session;
  await persistCurrentSession();
  selectedTab = 'AI';
  updateContext({ activeTab: 'AI' });
  renderAIWorkspace();
  renderDrawerView();
}

function renderSessionList() {
  const heading = document.createElement('h2');
  heading.className = 'drawer-section-title';
  heading.textContent = 'Lịch sử phiên chat';
  drawerView.append(heading);
  if (!sessions.length) {
    const empty = document.createElement('p');
    empty.className = 'status-line';
    empty.textContent = 'Chưa có phiên chat. Tạo một phiên mới để bắt đầu.';
    drawerView.append(empty);
    return;
  }
  sessions.forEach((session) => {
    const item = document.createElement('article');
    item.className = `session-item${currentSession?.id === session.id ? ' selected' : ''}`;
    const open = document.createElement('button');
    open.className = 'session-open';
    const title = document.createElement('strong');
    title.textContent = session.title || 'Phiên chat';
    const meta = document.createElement('small');
    const date = session.updatedAt ? new Date(session.updatedAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const model = session.preferences?.modelLabel ?? session.preferences?.model ?? 'Chưa chọn model';
    const contextNames = [];
    if (session.preferences?.autoContext) {
      contextNames.push(session.preferences.activeTitle ?? lesson?.payload.title ?? 'bài đang học');
    }
    (session.preferences?.lessonIds ?? []).forEach((id) => {
      const selectedLesson = lessons.find((item) => item.id === id);
      if (selectedLesson) contextNames.push(selectedLesson.payload.title);
    });
    if (session.preferences?.includeFormula) contextNames.push('Formula Hub');
    if (session.preferences?.libraryContext?.title) contextNames.push(session.preferences.libraryContext.title);
    const contextLabel = contextNames.length ? ` · ${contextNames.join(', ')}` : ' · chat độc lập';
    meta.textContent = `${date} · ${model}${contextLabel}`;
    open.append(title, meta);
    open.addEventListener('click', () => openSession(session));
    const actions = document.createElement('div');
    actions.className = 'session-actions';
    const rename = document.createElement('button');
    rename.className = 'icon-button session-action';
    rename.textContent = '✎';
    rename.setAttribute('aria-label', 'Đổi tên phiên');
    rename.addEventListener('click', async () => {
      const name = window.prompt('Tên phiên chat', session.title);
      if (!name?.trim()) return;
      session.title = name.trim();
      if (currentSession?.id === session.id) {
        currentSession.title = session.title;
        if (workspace === 'ai') document.querySelector('#workspace-title').textContent = session.title;
      }
      await saveChatSession(session);
      renderDrawerView();
    });
    const remove = document.createElement('button');
    remove.className = 'icon-button session-action';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Xóa phiên');
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Xóa phiên "${session.title}"?`)) return;
      await deleteChatSession(session.id);
      sessions = sessions.filter((entry) => entry.id !== session.id);
      if (currentSession?.id === session.id) {
        currentSession = null;
        workspace = 'lesson';
        document.querySelector('.app-main').classList.remove('ai-mode');
        await showLesson();
      }
      renderDrawerView();
    });
    actions.append(rename, remove);
    item.append(open, actions);
    drawerView.append(item);
  });
}

function makeLibraryCallbacks() {
  return {
    onOpenItem: (item) => {
      showLibraryDocument(item).catch((error) => toast(`Không thể mở tài liệu: ${error.message}`));
    },
    onOpenInDock: (item) => {
      openLibraryItemInDock(item);
      if (mobileLayout.matches) setDrawer(false);
    },
    onAttachToChat: async (item) => {
      try {
        let excerpt = item.contextText ?? '';
        if (item.source === 'drive' && item.driveFileId) {
          const fetched = await fetchBoundedDriveTextForChat({
            driveFileId: item.driveFileId,
            mimeType: item.mimeType,
          });
          if (fetched) {
            excerpt = `${item.title} (${item.sourceLabel ?? item.kind}):\n${fetched}`;
          }
        }
        const fallback = item.url
          ? `${item.title}: ${item.url}${item.description ? `\n${item.description}` : ''}`
          : `${item.title}${item.description ? `\n${item.description}` : ''}`;
        await attachLibraryContext({
          id: item.id,
          title: item.title,
          type: item.kind ?? item.type ?? 'drive-file',
          sourceLabel: item.sourceLabel ?? item.kind ?? 'Thư viện',
          content: String(excerpt || fallback).slice(0, 16000),
        });
      } catch (error) {
        toast(error.message);
      }
    },
    onToast: toast,
  };
}

function renderDrawerView() {
  renderNavigation();
  unmountDrawerTree?.();
  unmountDrawerTree = null;
  drawerView.replaceChildren();
  if (selectedTab === 'AI') {
    renderSessionList();
  } else if (selectedTab === 'Bài học') {
    unmountDrawerTree = mountCourseTree(drawerView, {
      onSelectUnit: () => {
        selectedTab = 'Bài học';
        updateContext({ activeTab: 'Bài học' });
        dockStore.setExpanded(false);
        showLesson();
        setDrawer(false);
      },
    });
  } else if (selectedTab === 'Thư viện') {
    unmountDrawerTree = mountLibraryDrawer(drawerView, makeLibraryCallbacks());
  } else if (selectedTab === 'Ứng dụng') {
    unmountDrawerTree = mountAppsDrawer(drawerView, {
      onLaunched: () => {
        if (mobileLayout.matches) setDrawer(false);
      },
    });
  } else if (selectedTab === 'Soạn bài') {
    const button = document.createElement('button');
    button.className = 'tree-item';
    button.textContent = 'Mở Studio soạn bài';
    button.addEventListener('click', () => { setDrawer(false); renderStudio(); });
    drawerView.append(button);
  } else {
    const activeTab = listNavigationTabs().find((tab) => tab.label === selectedTab);
    if (activeTab?.placeholder) {
      const heading = document.createElement('h2');
      heading.className = 'drawer-section-title';
      heading.textContent = activeTab.label;
      const status = document.createElement('p');
      status.className = 'status-line';
      status.textContent = 'Khu vực này đã được đăng ký làm điểm mở rộng và sẽ có nội dung ở giai đoạn tiếp theo.';
      drawerView.append(heading, status);
    } else {
      const button = document.createElement('button');
      button.className = 'tree-item';
      button.textContent = 'Mở cấu hình';
      button.addEventListener('click', () => { setDrawer(false); renderSettings(); });
      drawerView.append(button);
    }
  }
}

async function showLesson() {
  workspace = 'lesson';
  setTitle(unitTitle);
  document.querySelector('.app-shell').classList.remove('ai-workspace-open');
  document.querySelector('.app-main').classList.remove('ai-mode');
  syncWorkspaceLayout();
  await ensureAcademyLoaded();
  if (workspace !== 'lesson') return;
  if (!unmountAcademyMain) {
    unmountAcademyMain = mountUnitWorkspace(page);
  }
  if (!unmountDrawerTree && selectedTab === 'Bài học') renderDrawerView();
}

async function showFormulas() {
  clearAcademyMain();
  workspace = 'lesson';
  dockStore.setExpanded(false);
  document.querySelector('.app-shell').classList.remove('ai-workspace-open');
  document.querySelector('.app-main').classList.remove('ai-mode');
  syncWorkspaceLayout();
  const lessonModule = await loadModule('lessonViewer');
  await lessonModule.disposeLessonResources(page);
  const module = await loadModule('formulaHub');
  module.renderFormulaHub(page, katex);
  updateContext({
    activeTab: 'Thư viện',
    lessonId: null,
    lessonTitle: null,
    selectedBlockId: null,
    widgetState: null,
  });
  setDrawer(false);
  document.querySelector('#current-title').textContent = 'Formula Hub';
}

async function attachLibraryContext(context) {
  const active = getActiveContext();
  const attachment = {
    ...context,
    widgetState: active.widgetState
      ? {
        widgetId: String(active.widgetState.widgetId ?? ''),
        payload: active.widgetState.payload,
      }
      : null,
  };
  toast(`Đã đính kèm "${attachment.title}" vào ngữ cảnh chat.`);
  const session = currentSession ?? sessions[0];
  if (session) await openSession(session);
  else await createSession();
  currentSession.preferences.libraryContext = attachment;
  updateContext({ libraryContext: attachment });
  await persistCurrentSession();
  setDrawer(false);
}

async function showLibraryDocument(item) {
  clearAcademyMain();
  workspace = 'lesson';
  libraryStore.setActiveItemId(item.id);
  dockStore.setExpanded(false);
  document.querySelector('.app-shell').classList.remove('ai-workspace-open');
  document.querySelector('.app-main').classList.remove('ai-mode');
  syncWorkspaceLayout();
  const lessonModule = await loadModule('lessonViewer');
  await lessonModule.disposeLessonResources(page);
  const viewer = await loadModule('libraryViewer');
  await viewer.renderLibraryDocument(page, item, {
    onAttach: (context) => attachLibraryContext(context).catch((error) => toast(error.message)),
    onOpenInDock: canOpenLibraryItemInDock(item) ? (doc) => openLibraryItemInDock(doc) : undefined,
    renderFormula: async (target) => {
      const formulaModule = await loadModule('formulaHub');
      formulaModule.renderFormulaHub(target, katex);
    },
  });
  updateContext({
    activeTab: 'Thư viện',
    lessonId: null,
    lessonTitle: null,
    selectedBlockId: null,
    widgetState: null,
  });
  setDrawer(false);
  document.querySelector('#current-title').textContent = item.title;
}

async function renderLibrary() {
  clearAcademyMain();
  workspace = 'lesson';
  libraryStore.setActiveItemId(null);
  document.querySelector('.app-shell').classList.remove('ai-workspace-open');
  document.querySelector('.app-main').classList.remove('ai-mode');
  syncWorkspaceLayout();
  const lessonModule = await loadModule('lessonViewer');
  await lessonModule.disposeLessonResources(page);
  await ensureLibraryLoaded();
  unmountLibraryMain = mountLibraryMain(page, makeLibraryCallbacks());
  document.querySelector('#current-title').textContent = 'Thư viện';
}

function renderStudio() {
  clearAcademyMain();
  setTitle('Soạn bài');
  workspace = 'lesson';
  document.querySelector('.app-shell').classList.remove('ai-workspace-open');
  document.querySelector('.app-main').classList.remove('ai-mode');
  page.innerHTML = `
    <h1 class="page-title">Soạn bài</h1>
    <p class="page-subtitle">Chỉnh JSON và xem trước trực tiếp. Lưu bài học qua cổng dữ liệu.</p>
    <div class="studio-layout">
      <div><textarea class="json-editor" id="lesson-json" aria-label="JSON bài học"></textarea>
        <button class="button button-soft" data-action="save-lesson">Lưu bài học</button>
      </div>
      <div class="studio-preview" id="studio-preview"></div>
    </div>`;
  const editor = document.querySelector('#lesson-json');
  editor.value = JSON.stringify(lesson, null, 2);
  let previewRevision = 0;
  editor.addEventListener('input', () => {
    try {
      const draft = JSON.parse(editor.value);
      const revision = ++previewRevision;
      const preview = document.querySelector('#studio-preview');
      preview.dataset.valid = 'true';
      import('./modules/lessonViewer/lessonViewer.js')
        .then(async ({ renderLesson: draw }) => {
          if (revision !== previewRevision || !preview.isConnected) return;
          await draw(draft, preview);
        })
        .catch((error) => {
          preview.dataset.valid = 'false';
          preview.textContent = `Không thể xem trước: ${error.message}`;
        });
    } catch (error) {
      const preview = document.querySelector('#studio-preview');
      preview.dataset.valid = 'false';
      preview.textContent = `JSON không hợp lệ: ${error.message}`;
    }
  });
  editor.dispatchEvent(new Event('input'));
  document.querySelector('[data-action="save-lesson"]').addEventListener('click', async () => {
    try {
      const draft = JSON.parse(editor.value);
      await saveLesson(draft);
      lesson = draft;
      lessons = await listLessons();
      toast('Đã lưu bài học.');
    } catch (error) {
      toast(`Không thể lưu: ${error.message}`);
    }
  });
}

function renderSettings() {
  clearAcademyMain();
  setTitle('Cấu hình');
  dockStore.setExpanded(false);
  document.querySelector('.app-shell').classList.remove('ai-workspace-open');
  document.querySelector('.app-main').classList.remove('ai-mode');
  syncWorkspaceLayout();
  page.innerHTML = `
    <h1 class="page-title">Cấu hình</h1>
    <p class="page-subtitle">Thiết lập chế độ chạy, nhà cung cấp AI và tích hợp cá nhân.</p>
    <section class="settings-section">
      <h3>Chế độ & xác thực</h3>
      <div class="setting-row"><span>Chế độ hiện tại</span><strong>${APP_MODE}</strong></div>
      <p class="status-line" id="auth-status">Đang kiểm tra trạng thái xác thực…</p>
      <button class="button button-soft" data-action="sign-in">Đăng nhập Google</button>
    </section>
    <div id="ai-settings-host"></div>
    <div id="theon-settings-host"></div>
    <section class="settings-section">
      <h3>Két bảo mật Firestore (liên kết cá nhân · chỉ mở khi đúng Gmail)</h3>
      <p class="status-line">Dữ liệu lưu trong Firestore <code>settings/secrets</code> — không nằm trên GitHub hay file build. Khóa Google AI Studio và vùng Vertex AI được quản lý tập trung ở mục <strong>Cấu hình AI</strong> phía trên.</p>
      <label for="vault-drive-folder">Thư mục Google Drive cá nhân (lưu tài liệu/PDF)</label>
      <input class="text-input" id="vault-drive-folder" type="url" placeholder="https://drive.google.com/drive/folders/…" />
      <label for="vault-calendar-embed">Google Calendar Embed URL (chế độ nhúng lịch)</label>
      <input class="text-input" id="vault-calendar-embed" placeholder="https://calendar.google.com/calendar/embed?src=…" />
      <label for="vault-jupyterlite-url">JupyterLite URL tự host (tùy chọn · bỏ trống để dùng bản mặc định)</label>
      <input class="text-input" id="vault-jupyterlite-url" type="url" placeholder="https://…/jupyterlite/lab/index.html" />
      <label for="vault-ketcher-url">Ketcher URL tự host (tùy chọn · bỏ trống để dùng bản mặc định)</label>
      <input class="text-input" id="vault-ketcher-url" type="url" placeholder="https://…/ketcher/index.html" />
      <button class="button button-soft" data-action="save-vault">Lưu vào Firestore Vault</button>
    </section>`;
  const aiSettingsHost = document.querySelector('#ai-settings-host');
  if (aiSettingsHost) {
    unmountAiSettings = mountAiSettings(aiSettingsHost, { onToast: toast });
  }
  const theonSettingsHost = document.querySelector('#theon-settings-host');
  if (theonSettingsHost) {
    unmountTheonSettings = mountTheonSettings(theonSettingsHost, { onToast: toast });
  }
  const vaultDriveInput = document.querySelector('#vault-drive-folder');
  const vaultCalendarInput = document.querySelector('#vault-calendar-embed');
  const vaultJupyterInput = document.querySelector('#vault-jupyterlite-url');
  const vaultKetcherInput = document.querySelector('#vault-ketcher-url');
  const fillVaultFields = (vault) => {
    vaultDriveInput.value = vault.driveFolderUrl ?? '';
    vaultCalendarInput.value = vault.calendarEmbedUrl ?? '';
    vaultJupyterInput.value = vault.jupyterLiteUrl ?? '';
    vaultKetcherInput.value = vault.ketcherUrl ?? '';
  };
  fillVaultFields(getCachedVault());
  document.querySelector('[data-action="save-vault"]').addEventListener('click', async () => {
    const folder = vaultDriveInput.value.trim();
    if (folder && !isAllowedDriveUrl(folder)) {
      toast('Thư mục Drive phải thuộc https://drive.google.com hoặc https://docs.google.com.');
      return;
    }
    const calendarRaw = vaultCalendarInput.value.trim();
    const calendarEmbedUrl = calendarRaw ? extractCalendarEmbedUrl(calendarRaw) : '';
    if (calendarRaw && !calendarEmbedUrl) {
      toast('URL Google Calendar phải dạng https://calendar.google.com/calendar/embed?src=…');
      return;
    }
    const jupyterLiteUrl = vaultJupyterInput.value.trim();
    if (jupyterLiteUrl && !isAllowedAppUrl(jupyterLiteUrl)) {
      toast('URL JupyterLite phải dùng https:// (hoặc http://localhost).');
      return;
    }
    const ketcherUrl = vaultKetcherInput.value.trim();
    if (ketcherUrl && !isAllowedAppUrl(ketcherUrl)) {
      toast('URL Ketcher phải dùng https:// (hoặc http://localhost).');
      return;
    }
    try {
      await saveOwnerVault({
        driveFolderUrl: folder,
        calendarEmbedUrl: calendarEmbedUrl ?? '',
        jupyterLiteUrl,
        ketcherUrl,
      });
      dockStore.refreshVaultUrls();
      toast('Đã lưu vào Firestore Vault (chỉ tài khoản chủ sở hữu đọc được).');
    } catch (error) {
      toast(`Không thể lưu Vault: ${error.message}`);
    }
  });
  document.querySelector('[data-action="sign-in"]').addEventListener('click', async () => {
    try {
      const user = await signInWithGoogle();
      document.querySelector('#auth-status').textContent = `Đã đăng nhập: ${user.email}`;
      const vault = await loadOwnerVault();
      fillVaultFields(vault);
      aiConfigStore.syncFromVault();
      dockStore.refreshVaultUrls();
      toast('Đã mở khóa Firestore Vault.');
    } catch (error) {
      toast(error.message);
    }
  });
  getAuthState((state) => {
    const status = document.querySelector('#auth-status');
    if (!status) return;
    status.textContent = APP_MODE === 'dev_mock'
      ? 'dev_mock · xác thực được bypass'
      : state.user ? `Đã đăng nhập: ${state.user.email}` : 'Chưa đăng nhập · chỉ chủ sở hữu đã xác minh được phép';
    if (state.authorized) {
      loadOwnerVault().then((vault) => {
        fillVaultFields(vault);
        aiConfigStore.syncFromVault();
        dockStore.refreshVaultUrls();
      }).catch(() => {});
    } else {
      clearVaultCache();
      aiConfigStore.syncFromVault();
    }
  }).catch((error) => toast(error.message));
}

function handleTab(tab) {
  if (tab.id !== 'settings' && !requireData()) return;
  // Cách A: clicking "Ứng dụng" only swaps the sidebar drawer to the Apps catalog
  // without disrupting the active left primary workspace (Bài học / AI / Thư viện / Soạn bài).
  if (tab.id === 'apps') {
    if (!mobileLayout.matches && document.body.classList.contains('sidebar-collapsed')) {
      document.body.classList.remove('sidebar-collapsed');
    }
    selectedTab = tab.label;
    renderDrawerView();
    return;
  }
  dockStore.setExpanded(false);
  selectedTab = tab.label;
  setTitle(tab.label);
  updateContext({ activeTab: tab.label });
  renderDrawerView();
  if (tab.id === 'ai') {
    const current = currentSession ?? sessions[0];
    if (current) openSession(current).catch((error) => toast(error.message));
    else createSession().catch((error) => toast(error.message));
    setDrawer(false);
  } else if (tab.id === 'library') {
    renderLibrary().catch((error) => toast(`Không thể mở thư viện: ${error.message}`));
  } else if (tab.id === 'studio') {
    if (!lesson) showLesson().then(renderStudio);
    else renderStudio();
  } else if (tab.id === 'settings') {
    workspace = 'lesson';
    document.querySelector('.app-main').classList.remove('ai-mode');
    renderSettings();
  } else if (tab.id === 'lesson') {
    showLesson();
  } else if (tab.moduleId) {
    clearAcademyMain();
    loadModule(tab.moduleId)
      .then((module) => {
        if (typeof module?.renderMain === 'function') return module.renderMain(page, { contextBus: { getActiveContext, updateContext } });
        throw new Error(`Module "${tab.moduleId}" does not export renderMain().`);
      })
      .catch((error) => toast(`Không thể mở ${tab.label}: ${error.message}`));
  } else {
    clearAcademyMain();
    workspace = 'lesson';
    document.querySelector('.app-shell').classList.remove('ai-workspace-open');
    document.querySelector('.app-main').classList.remove('ai-mode');
    syncWorkspaceLayout();
    page.replaceChildren();
    const heading = document.createElement('h1');
    heading.className = 'page-title';
    heading.textContent = tab.label;
    const message = document.createElement('p');
    message.className = 'page-subtitle';
    message.textContent = 'Khu vực mở rộng đã được đăng ký trong module registry, sẵn sàng cho module tương lai.';
    page.append(heading, message);
  }
}

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'drawer') toggleSidebar();
  if (action === 'open-settings') window.dispatchEvent(new CustomEvent('theolab:open-settings'));
  if (action === 'dock' && requireData()) dockStore.toggleOpen();
  if (action === 'toggle-theon' && requireData()) {
    dockStore.toggleTheon();
    if (mobileLayout.matches) setDrawer(false);
  }
  if (action === 'formula') showFormulas();
  if (action === 'palette') window.dispatchEvent(new CustomEvent('theolab:open-palette'));
  if (action === 'new-session') {
    dockStore.setExpanded(false);
    createSession().then(() => setDrawer(false)).catch((error) => toast(error.message));
  }
  if (action === 'toggle-overflow') {
    overflowExpanded = !overflowExpanded;
    renderNavigation();
  }
});
backdrop.addEventListener('click', () => setDrawer(false));
window.addEventListener('theolab:open-settings', () => {
  selectedTab = 'Cấu hình';
  renderDrawerView();
  renderSettings();
  setDrawer(false);
});
window.addEventListener('theolab:open-formula', () => {
  showFormulas().catch((error) => toast(error.message));
});
window.addEventListener('theolab:navigate-deep-link', async (event) => {
  const deepLink = event.detail;
  if (typeof deepLink !== 'string') return;
  const ok = await navigateToDeepLink(deepLink);
  if (ok) {
    dockStore.setExpanded(false);
    selectedTab = 'Bài học';
    updateContext({ activeTab: 'Bài học' });
    await showLesson();
    setDrawer(false);
  }
});

async function start() {
  unmountDock?.();
  unmountDock = mountWorkspaceDock(dockPane, {
    onToast: toast,
  });
  initDockSplitter();
  onDockLayoutChange((snapshot) => {
    dockLayout = snapshot;
    syncWorkspaceLayout();
  });

  const paletteHost = document.createElement('div');
  document.body.append(paletteHost);
  mountCommandPalette(paletteHost, {
    onNavigate: (deepLink) => {
      window.dispatchEvent(new CustomEvent('theolab:navigate-deep-link', { detail: deepLink }));
    },
  });

  onAcademyEvent((event) => {
    if (event.type === 'toast' && event.message) toast(event.message);
    if (event.type === 'unit-selected' && event.title) {
      unitTitle = event.title;
      if (selectedTab === 'Bài học') setTitle(unitTitle);
    }
  });
  if (APP_MODE === 'dev_mock') {
    await loadData();
    return;
  }
  showSignIn();
  await getAuthState((state) => {
    if (!state.authorized) {
      clearVaultCache();
      aiConfigStore.syncFromVault();
      return;
    }
    loadData().catch((error) => toast(`Không thể tải dữ liệu: ${error.message}`));
  });
}

function showSignIn() {
  dockStore.setOpen(false);
  selectedTab = 'Cấu hình';
  renderNavigation();
  renderSettings();
}

async function loadData() {
  if (dataReady || dataLoading) return;
  dataLoading = true;
  try {
    await loadOwnerVault().catch((error) => toast(`Không thể mở Vault: ${error.message}`));
    aiConfigStore.syncFromVault();
    await ensureLibraryLoaded();
    dockStore.refreshVaultUrls();
    lesson = await loadLesson();
    lessons = await listLessons();
    sessions = await listChatSessions();
    dataReady = true;
    selectedTab = 'Bài học';
    updateContext({
      lessonId: lesson.id,
      lessonTitle: lesson.payload.title,
      activeTab: 'Bài học',
    });
    renderDrawerView();
    await showLesson();
  } finally {
    dataLoading = false;
  }
}

start().catch((error) => toast(`Không thể khởi động TheoLab: ${error.message}`));
