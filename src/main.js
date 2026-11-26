import './styles/app.css';
import katex from 'katex';
import sampleLesson from './mocks/sampleLesson.json';
import { APP_MODE } from './config/runtimeConfig.js';
import { NAV_TABS } from './config/navigationConfig.js';
import {
  deleteChatSession,
  getApiKey,
  getLocalSetting,
  listChatSessions,
  listLessons,
  loadLesson,
  saveApiKey,
  saveChatSession,
  saveLesson,
  saveLocalSetting,
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
import { LIBRARY_CATEGORIES, LIBRARY_DOCUMENTS } from './modules/library/libraryCatalog.js';
import { runAgent } from './modules/agents/agentLoop.js';
import { clearMessages, mountChatComposer, renderMessage } from './modules/agents/chatUI.js';
import { listSkills, setSkillEnabled } from './modules/agents/skills/registry.js';
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
  addDriveLibraryItem,
  listDriveLibraryItems,
  removeDriveLibraryItem,
} from './core/driveLibrary.ts';

const defaultModels = {
  vertex: { model: 'gemini-2.5-flash', label: 'Vertex AI · Gemini 2.5 Flash' },
  openai: { model: 'gpt-4.1', label: 'GPT-4.1' },
  anthropic: { model: 'claude-sonnet-4-20250514', label: 'Claude Sonnet' },
  google: { model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  openrouter: { model: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3' },
  custom: { model: 'custom', label: 'Custom model' },
};
const app = document.querySelector('#app');
let lesson;
let lessons = [];
let sessions = [];
let currentSession = null;
let selectedTab = 'Bài học';
let overflowExpanded = false;
let currentLibraryItemId = null;
let drawerOpen = false;
let quickChatOpen = false;
let workspace = 'lesson';
let quickMessages = [];
let quickPreferences = makeDefaultPreferences(true);
let quickComposerCleanup;
let workspaceComposerCleanup;
let driveLibraryItems = [];
let quickRequest = 0;
let saveQueue = Promise.resolve();
let unmountDrawerTree = null;
let unmountAcademyMain = null;

function clearAcademyMain() {
  unmountAcademyMain?.();
  unmountAcademyMain = null;
}

function makeDefaultPreferences(withContext = false) {
  const provider = getLocalSetting('provider', APP_MODE === 'firebase_auth' ? 'vertex' : 'google');
  const defaultModel = defaultModels[provider] ?? defaultModels.google;
  return {
    provider,
    model: getLocalSetting(`model:${provider}`, defaultModel.model),
    modelLabel: defaultModel.label,
    skill: 'supporter',
    temperature: 0.3,
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
  <div class="app-shell">
    <header class="topbar">
      <button class="icon-button menu-button" aria-label="Mở menu" data-action="drawer">☰</button>
      <h1 class="topbar-title" id="current-title">TheoLab</h1>
      <div class="topbar-actions">
        <button class="quick-button" data-action="formula">✦ Công thức</button>
        <button class="quick-button" data-action="chat" aria-pressed="false">✧ Chat Agent</button>
      </div>
    </header>
    <main class="app-main">
      <section class="content-pane"><div class="page-content" id="page-content"></div></section>
      <aside class="chat-pane hidden" id="chat-pane" aria-label="Chat nhanh với Agent">
        <div class="mobile-grabber"></div>
        <div class="chat-header">
          <div class="chat-heading"><span class="sparkle">✦</span> Agent học tập</div>
          <button class="icon-button" data-action="chat" aria-label="Đóng chat">×</button>
        </div>
        <div class="chat-messages" id="quick-messages"></div>
        <div class="composer-host" id="quick-composer"></div>
      </aside>
    </main>
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
    <div class="drawer-footer">
      <span class="avatar" aria-hidden="true">T</span><span class="footer-name">Không gian của tôi</span>
      <button class="icon-button" data-action="open-settings" aria-label="Mở cấu hình" title="Cấu hình">⚙</button>
    </div>
  </aside>
  <div id="toast" class="toast hidden" role="status"></div>
`;

const page = document.querySelector('#page-content');
const drawer = document.querySelector('#drawer');
const backdrop = document.querySelector('#drawer-backdrop');
const drawerView = document.querySelector('#drawer-view');
const quickPane = document.querySelector('#chat-pane');
const quickMessagesRoot = document.querySelector('#quick-messages');

function toast(message) {
  const node = document.querySelector('#toast');
  node.textContent = message;
  node.classList.remove('hidden');
  window.setTimeout(() => node.classList.add('hidden'), 3600);
}

const mobileLayout = window.matchMedia('(max-width: 800px)');

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

function setQuickChat(open) {
  quickChatOpen = open;
  quickPane.classList.toggle('hidden', false);
  const mobile = window.matchMedia('(max-width: 800px)').matches;
  quickPane.classList.toggle('mobile-open', open && mobile);
  document.querySelector('.app-main').classList.toggle('chat-open', open && !mobile);
  document.querySelectorAll('[data-action="chat"]').forEach((button) => {
    button.classList.toggle('active', open);
    button.setAttribute('aria-pressed', String(open));
  });
  if (!open) {
    quickPane.classList.add('hidden');
    quickPane.classList.remove('mobile-open');
    return;
  }
  quickPreferences = {
    ...quickPreferences,
    autoContext: Boolean(getActiveContext().lessonId),
  };
  if (!quickMessages.length) {
    quickMessages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Mình cùng luyện một câu chuẩn độ nhé. Bạn có 45 giây để trả lời.',
      exercise: { prompt: 'Thể tích NaOH (mL) · đáp số 25.0 ± 0.1', answer: 25, tolerance: 0.1, seconds: 45 },
    });
  }
  mountQuickComposer();
  renderQuickMessages();
}

function renderQuickMessages() {
  clearMessages(quickMessagesRoot);
  quickMessages.forEach((message) => renderMessage(quickMessagesRoot, message, {
    onExerciseResult: (result) => updateContext({ selectedBlockId: 'chat-timed-exercise', lastExerciseResult: result }),
  }));
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
  const now = new Date().toISOString();
  const provider = getLocalSetting('provider', 'google');
  const defaultModel = defaultModels[provider] ?? defaultModels.google;
  const session = {
    id: crypto.randomUUID(),
    title: 'Phiên chat mới',
    createdAt: now,
    updatedAt: now,
    messages: [],
    preferences: {
      ...makeDefaultPreferences(Boolean(getActiveContext().lessonId)),
      provider,
      model: getLocalSetting(`model:${provider}`, defaultModel.model),
      modelLabel: defaultModel.label,
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

function makeLibraryEntry(item, onChanged) {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = '4px';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `library-entry${currentLibraryItemId === item.id ? ' selected' : ''}`;
  button.style.flex = '1';
  const title = document.createElement('strong');
  title.textContent = item.title;
  const source = document.createElement('small');
  source.textContent = item.sourceLabel ?? item.type;
  button.append(title, source);
  button.addEventListener('click', () => {
    showLibraryDocument(item).catch((error) => toast(`Không thể mở tài liệu: ${error.message}`));
  });
  row.append(button);

  if (item.userAdded) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-button';
    del.title = 'Xóa khỏi thư viện';
    del.setAttribute('aria-label', `Xóa ${item.title}`);
    del.textContent = '×';
    del.addEventListener('click', async (event) => {
      event.stopPropagation();
      await removeDriveLibraryItem(item.id);
      driveLibraryItems = await listDriveLibraryItems();
      toast(`Đã xóa "${item.title}" khỏi thư viện.`);
      onChanged?.();
    });
    row.append(del);
  }
  return row;
}

function renderLibraryDrawer() {
  const search = document.createElement('input');
  search.className = 'search-input';
  search.placeholder = 'Tìm nhanh trong thư viện';
  search.setAttribute('aria-label', 'Tìm tài liệu trong thư viện');

  const driveControls = document.createElement('div');
  driveControls.style.display = 'flex';
  driveControls.style.flexDirection = 'column';
  driveControls.style.gap = '6px';
  driveControls.style.margin = '8px 0';

  const folderUrl = getCachedVault().driveFolderUrl;
  if (folderUrl) {
    const folderLink = document.createElement('a');
    folderLink.className = 'tree-item';
    folderLink.href = folderUrl;
    folderLink.target = '_blank';
    folderLink.rel = 'noopener noreferrer';
    folderLink.textContent = '↗ Mở thư mục Drive cá nhân';
    driveControls.append(folderLink);
  }

  const addToggle = document.createElement('button');
  addToggle.type = 'button';
  addToggle.className = 'tree-item';
  addToggle.textContent = '＋ Thêm tài liệu Google Drive';

  const addForm = document.createElement('form');
  addForm.hidden = true;
  addForm.style.display = 'none';
  addForm.style.flexDirection = 'column';
  addForm.style.gap = '6px';
  addForm.style.padding = '8px';
  addForm.style.borderRadius = '12px';
  addForm.style.background = 'var(--surface-elevated)';

  const titleInput = document.createElement('input');
  titleInput.className = 'search-input';
  titleInput.placeholder = 'Tên tài liệu (VD: Đề thi Hóa phân tích)';
  const urlInput = document.createElement('input');
  urlInput.className = 'search-input';
  urlInput.type = 'url';
  urlInput.placeholder = 'https://drive.google.com/file/d/…';
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'button button-soft';
  submitBtn.textContent = 'Lưu vào Thư viện';
  addForm.append(titleInput, urlInput, submitBtn);

  addToggle.addEventListener('click', () => {
    const show = addForm.hidden;
    addForm.hidden = !show;
    addForm.style.display = show ? 'flex' : 'none';
  });

  driveControls.append(addToggle, addForm);

  const categoriesRoot = document.createElement('div');
  const renderCategories = () => {
    const query = search.value.trim().toLocaleLowerCase('vi');
    const allDocs = [...driveLibraryItems, ...LIBRARY_DOCUMENTS];
    categoriesRoot.replaceChildren();
    LIBRARY_CATEGORIES.forEach((category) => {
      const entries = allDocs.filter((item) => item.category === category.id
        && `${item.title} ${item.sourceLabel ?? ''}`.toLocaleLowerCase('vi').includes(query));
      if (!entries.length) return;
      const heading = document.createElement('h2');
      heading.className = 'drawer-section-title library-category-title';
      heading.textContent = category.label;
      categoriesRoot.append(heading, ...entries.map((entry) => makeLibraryEntry(entry, renderCategories)));
    });
  };

  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const created = await addDriveLibraryItem({ title: titleInput.value, url: urlInput.value });
      driveLibraryItems = [created, ...driveLibraryItems];
      titleInput.value = '';
      urlInput.value = '';
      addForm.hidden = true;
      addForm.style.display = 'none';
      toast(`Đã thêm "${created.title}" vào thư viện Drive.`);
      renderCategories();
      await showLibraryDocument(created);
    } catch (error) {
      toast(error.message);
    }
  });

  search.addEventListener('input', renderCategories);
  renderCategories();
  drawerView.append(search, driveControls, categoriesRoot);
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
        showLesson();
        setDrawer(false);
      },
    });
  } else if (selectedTab === 'Thư viện') {
    renderLibraryDrawer();
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
  document.querySelector('.app-shell').classList.remove('ai-workspace-open');
  document.querySelector('.app-main').classList.remove('ai-mode');
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
  document.querySelector('.app-shell').classList.remove('ai-workspace-open');
  document.querySelector('.app-main').classList.remove('ai-mode');
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
  currentLibraryItemId = item.id;
  document.querySelector('.app-shell').classList.remove('ai-workspace-open');
  document.querySelector('.app-main').classList.remove('ai-mode');
  const lessonModule = await loadModule('lessonViewer');
  await lessonModule.disposeLessonResources(page);
  const viewer = await loadModule('libraryViewer');
  await viewer.renderLibraryDocument(page, item, {
    onAttach: (context) => attachLibraryContext(context).catch((error) => toast(error.message)),
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
  renderDrawerView();
  setDrawer(false);
  document.querySelector('#current-title').textContent = item.title;
}

async function renderLibrary() {
  workspace = 'lesson';
  currentLibraryItemId = null;
  document.querySelector('.app-shell').classList.remove('ai-workspace-open');
  document.querySelector('.app-main').classList.remove('ai-mode');
  const lessonModule = await loadModule('lessonViewer');
  await lessonModule.disposeLessonResources(page);
  page.replaceChildren();
  const heading = document.createElement('h1');
  heading.className = 'page-title';
  heading.textContent = 'Thư viện';
  const description = document.createElement('p');
  description.className = 'page-subtitle';
  description.textContent = 'Chọn tài liệu, bộ công thức hoặc mô phỏng để mở trực tiếp trên canvas.';
  page.append(heading, description);
  LIBRARY_CATEGORIES.forEach((category) => {
    const section = document.createElement('section');
    section.className = 'library-section';
    const categoryHeading = document.createElement('h2');
    categoryHeading.className = 'library-section-title';
    categoryHeading.textContent = category.label;
    section.append(categoryHeading);
    LIBRARY_DOCUMENTS.filter((item) => item.category === category.id)
      .forEach((item) => section.append(makeLibraryEntry(item)));
    page.append(section);
  });
  document.querySelector('#current-title').textContent = 'Thư viện';
}

function renderStudio() {
  clearAcademyMain();
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
  document.querySelector('.app-shell').classList.remove('ai-workspace-open');
  const skills = listSkills();
  page.innerHTML = `
    <h1 class="page-title">Cấu hình</h1>
    <p class="page-subtitle">Thiết lập chế độ chạy và tích hợp cá nhân.</p>
    <section class="settings-section">
      <h3>Chế độ & xác thực</h3>
      <div class="setting-row"><span>Chế độ hiện tại</span><strong>${APP_MODE}</strong></div>
      <p class="status-line" id="auth-status">Đang kiểm tra trạng thái xác thực…</p>
      <button class="button button-soft" data-action="sign-in">Đăng nhập Google</button>
    </section>
    <section class="settings-section">
      <h3>Két bảo mật Firestore (chỉ mở khi đúng Gmail)</h3>
      <p class="status-line">Dữ liệu lưu trong Firestore <code>settings/secrets</code> — không nằm trên GitHub hay file build.</p>
      <label for="vault-drive-folder">Thư mục Google Drive cá nhân (lưu tài liệu/PDF)</label>
      <input class="text-input" id="vault-drive-folder" type="url" placeholder="https://drive.google.com/drive/folders/…" />
      <label for="vault-vertex-location">Vùng Vertex AI (Firebase AI Logic)</label>
      <input class="text-input" id="vault-vertex-location" placeholder="us-central1" />
      <label for="vault-gemini-key">Gemini API Key (cho Vector Embedding · tùy chọn)</label>
      <input class="text-input" id="vault-gemini-key" type="password" autocomplete="off" placeholder="Nhập để lưu vào Firestore" />
      <button class="button button-soft" data-action="save-vault">Lưu vào Firestore Vault</button>
    </section>
    <section class="settings-section">
      <h3>BYOK · nhà cung cấp AI</h3>
      <label for="provider">Nhà cung cấp</label>
      <select class="select-input" id="provider">
        <option value="vertex">Vertex AI (Firebase AI Logic · không cần key)</option>
        <option value="google">Google AI Studio</option><option value="anthropic">Anthropic</option>
        <option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option><option value="custom">Custom</option>
      </select>
      <label for="api-key">API Key (chỉ lưu trong trình duyệt này)</label>
      <input class="text-input" id="api-key" type="password" autocomplete="off" placeholder="API Key" />
      <button class="button button-soft" data-action="save-key">Lưu khóa</button>
      <label for="model">Model cho nhà cung cấp</label>
      <input class="text-input" id="model" placeholder="Model ID" />
      <label for="custom-endpoint">Custom endpoint (OpenAI-compatible)</label>
      <input class="text-input" id="custom-endpoint" placeholder="https://…" />
    </section>
    <section class="settings-section">
      <h3>MCP & Skills</h3>
      <label for="mcp-url">MCP Server URL (HTTP/SSE)</label>
      <input class="text-input" id="mcp-url" placeholder="https://…" />
      ${skills.map((skill) => `<div class="setting-row"><label for="skill-${skill.id}">${skill.name}</label><input id="skill-${skill.id}" type="checkbox" ${skill.enabled ? 'checked' : ''} data-skill="${skill.id}" /></div>`).join('')}
      <p class="status-line">Khóa BYOK lưu ở localStorage chỉ tiện cho máy cá nhân; khuyến nghị dùng Vertex AI hoặc Firestore Vault.</p>
    </section>`;
  const provider = document.querySelector('#provider');
  const keyInput = document.querySelector('#api-key');
  const modelInput = document.querySelector('#model');
  const endpointInput = document.querySelector('#custom-endpoint');
  const vaultDriveInput = document.querySelector('#vault-drive-folder');
  const vaultLocationInput = document.querySelector('#vault-vertex-location');
  const vaultGeminiInput = document.querySelector('#vault-gemini-key');
  const fillVaultFields = (vault) => {
    vaultDriveInput.value = vault.driveFolderUrl ?? '';
    vaultLocationInput.value = vault.vertexLocation ?? 'us-central1';
    vaultGeminiInput.value = vault.geminiApiKey ?? '';
  };
  fillVaultFields(getCachedVault());
  document.querySelector('[data-action="save-vault"]').addEventListener('click', async () => {
    const folder = vaultDriveInput.value.trim();
    if (folder && !isAllowedDriveUrl(folder)) {
      toast('Thư mục Drive phải thuộc https://drive.google.com hoặc https://docs.google.com.');
      return;
    }
    try {
      await saveOwnerVault({
        driveFolderUrl: folder,
        vertexLocation: vaultLocationInput.value.trim() || 'us-central1',
        geminiApiKey: vaultGeminiInput.value.trim(),
      });
      toast('Đã lưu vào Firestore Vault (chỉ tài khoản chủ sở hữu đọc được).');
    } catch (error) {
      toast(`Không thể lưu Vault: ${error.message}`);
    }
  });
  const updateProviderFields = () => {
    const defaults = defaultModels[provider.value] ?? defaultModels.vertex;
    keyInput.value = getApiKey(provider.value);
    modelInput.value = getLocalSetting(`model:${provider.value}`, defaults.model);
  };
  provider.value = getLocalSetting('provider', APP_MODE === 'firebase_auth' ? 'vertex' : 'google');
  updateProviderFields();
  endpointInput.value = getLocalSetting('custom-endpoint');
  provider.addEventListener('change', () => {
    saveLocalSetting('provider', provider.value);
    updateProviderFields();
  });
  modelInput.addEventListener('change', () => {
    saveLocalSetting(`model:${provider.value}`, modelInput.value.trim());
  });
  endpointInput.addEventListener('change', () => saveLocalSetting('custom-endpoint', endpointInput.value.trim()));
  document.querySelector('#mcp-url').value = getLocalSetting('mcp-url');
  document.querySelector('#mcp-url').addEventListener('change', (event) => saveLocalSetting('mcp-url', event.target.value));
  document.querySelector('[data-action="save-key"]').addEventListener('click', () => {
    saveApiKey(provider.value, keyInput.value);
    toast('Đã lưu khóa trong localStorage của trình duyệt.');
  });
  document.querySelector('[data-action="sign-in"]').addEventListener('click', async () => {
    try {
      const user = await signInWithGoogle();
      document.querySelector('#auth-status').textContent = `Đã đăng nhập: ${user.email}`;
      const vault = await loadOwnerVault();
      fillVaultFields(vault);
      toast('Đã mở khóa Firestore Vault.');
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelectorAll('[data-skill]').forEach((input) => input.addEventListener('change', () => setSkillEnabled(input.dataset.skill, input.checked)));
  getAuthState((state) => {
    const status = document.querySelector('#auth-status');
    if (!status) return;
    status.textContent = APP_MODE === 'dev_mock'
      ? 'dev_mock · xác thực được bypass'
      : state.user ? `Đã đăng nhập: ${state.user.email}` : 'Chưa đăng nhập · chỉ chủ sở hữu đã xác minh được phép';
    if (state.authorized) {
      loadOwnerVault().then(fillVaultFields).catch(() => {});
    } else {
      clearVaultCache();
    }
  }).catch((error) => toast(error.message));
}

function mountQuickComposer() {
  const host = document.querySelector('#quick-composer');
  if (!host) return;
  quickComposerCleanup?.();
  quickComposerCleanup = mountChatComposer(host, {
    getState: () => quickPreferences,
    onStateChange: (next) => { quickPreferences = next; },
    lessons,
    activeTitle: lesson?.payload.title,
    onSend: sendQuickMessage,
  });
}

async function sendQuickMessage(prompt, preferences) {
  const requestId = ++quickRequest;
  const user = { id: crypto.randomUUID(), role: 'user', content: prompt };
  const assistant = { id: crypto.randomUUID(), role: 'assistant', content: 'Đang suy nghĩ…' };
  quickMessages.push(user, assistant);
  renderQuickMessages();
  try {
    const context = await buildAgentContext(preferences);
    const answer = await runAgent({ prompt, provider: preferences.provider, model: preferences.model, preferences, context });
    if (requestId === quickRequest) assistant.content = answer;
  } catch (error) {
    if (requestId === quickRequest) assistant.content = `Không thể gọi Agent: ${error.message}`;
  }
  if (requestId === quickRequest) renderQuickMessages();
}

function handleTab(tab) {
  selectedTab = tab.label;
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
  if (action === 'chat') setQuickChat(!quickChatOpen);
  if (action === 'formula') showFormulas();
  if (action === 'palette') window.dispatchEvent(new CustomEvent('theolab:open-palette'));
  if (action === 'new-session') {
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
window.addEventListener('theolab:navigate-deep-link', async (event) => {
  const deepLink = event.detail;
  if (typeof deepLink !== 'string') return;
  const ok = await navigateToDeepLink(deepLink);
  if (ok) {
    selectedTab = 'Bài học';
    updateContext({ activeTab: 'Bài học' });
    await showLesson();
    setDrawer(false);
  }
});

async function start() {
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
      document.querySelector('#current-title').textContent = event.title;
    }
  });
  getAuthState((state) => {
    if (state.authorized) {
      loadOwnerVault().catch(() => {});
      listDriveLibraryItems()
        .then((items) => {
          driveLibraryItems = items;
          if (selectedTab === 'Thư viện') renderDrawerView();
        })
        .catch(() => {});
    } else {
      clearVaultCache();
    }
  }).catch(() => {});

  driveLibraryItems = await listDriveLibraryItems();
  lesson = await loadLesson();
  lessons = await listLessons();
  sessions = await listChatSessions();
  updateContext({
    lessonId: lesson.id,
    lessonTitle: lesson.payload.title,
    activeTab: 'Bài học',
  });
  renderDrawerView();
  await showLesson();
}

start().catch((error) => toast(`Không thể khởi động TheoLab: ${error.message}`));
