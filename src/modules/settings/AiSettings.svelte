<script lang="ts">
  import { APP_MODE } from '../../config/runtimeConfig.js';
  import { getLocalSetting, saveLocalSetting } from '../../core/dataGateway.js';
  import { getCachedVault, saveOwnerVault } from '../../core/secretsVault';
  import {
    aiConfigStore,
    resolveProviderApiKey,
    type DiscoveredRemoteModel,
    type ProviderTestResult,
  } from '../../core/aiConfigStore.svelte';
  import {
    getProviderMetadata,
    isBuiltinProviderId,
  } from '../../domain/ai/providerCatalog';
  import type { ModelEntry, ProviderConfig, ProviderId } from '../../domain/ai/schemas';
  import { listSkills, setSkillEnabled } from '../agents/skills/registry.js';

  let { onToast }: { onToast?: (message: string) => void } = $props();

  type SettingsTab = 'providers' | 'models' | 'defaults' | 'profiles' | 'advanced' | 'backup';
  let activeSection = $state<SettingsTab>('providers');

  // Provider UI state
  let keyDrafts = $state<Record<string, string>>({});
  let keyVisible = $state<Record<string, boolean>>({});
  let baseUrlDrafts = $state<Record<string, string>>({});
  let testingProvider = $state<Record<string, boolean>>({});
  let testResults = $state<Record<string, ProviderTestResult>>({});
  let savingKey = $state<Record<string, boolean>>({});

  // Add custom provider form
  let showAddCustomProvider = $state(false);
  let newCustomLabel = $state('');
  let newCustomBaseUrl = $state('');
  let newCustomDefaultModel = $state('');

  // Models section state
  let modelFilterProvider = $state<string>('all');
  let modelSearch = $state('');
  let showHiddenModels = $state(false);
  let showAddModelForm = $state(false);
  let editingModelId = $state<string | null>(null);
  let modelFormProvider = $state<ProviderId>('google');
  let modelFormModelId = $state('');
  let modelFormLabel = $state('');
  let modelFormDesc = $state('');
  let modelFormVision = $state(false);
  let modelFormReasoning = $state(false);
  let modelFormMaxContext = $state('');

  // Remote model discovery state
  let fetchModelsProvider = $state<ProviderId>('google');
  let fetchingModels = $state(false);
  let fetchModelsError = $state('');
  let discoveredModels = $state<DiscoveredRemoteModel[]>([]);
  let discoveredFilter = $state('');
  let selectedDiscovered = $state<Record<string, boolean>>({});

  // Profile creation state
  let newProfileName = $state('');

  // Advanced section state
  let vertexLocation = $state(getCachedVault().vertexLocation ?? 'global');
  let savingVertexLocation = $state(false);
  let mcpUrl = $state(typeof localStorage !== 'undefined' ? getLocalSetting('mcp-url', '') : '');
  let skills = $state(listSkills());

  // Import/Export state
  let importText = $state('');
  let showImportPaste = $state(false);

  const providers = $derived(aiConfigStore.providers);
  const defaults = $derived(aiConfigStore.defaults);
  const profiles = $derived(aiConfigStore.profiles);

  // Keep local drafts synchronized with store & keyRevision
  $effect(() => {
    void aiConfigStore.keyRevision;
    const nextKeys: Record<string, string> = {};
    const nextUrls: Record<string, string> = {};
    for (const p of aiConfigStore.providers) {
      nextKeys[p.id] = resolveProviderApiKey(p.id);
      nextUrls[p.id] = p.baseUrl ?? '';
    }
    keyDrafts = nextKeys;
    baseUrlDrafts = nextUrls;
    vertexLocation = getCachedVault().vertexLocation ?? 'global';
  });

  const filteredModels = $derived(
    aiConfigStore.listModels({
      providerId: modelFilterProvider === 'all' ? undefined : modelFilterProvider,
      includeHidden: showHiddenModels,
      query: modelSearch,
    }),
  );

  const modelsForDefaultProvider = $derived(
    aiConfigStore.listModels({
      providerId: defaults.providerId,
      includeHidden: false,
    }),
  );

  const filteredDiscoveredModels = $derived.by(() => {
    const q = discoveredFilter.trim().toLowerCase();
    if (!q) return discoveredModels;
    return discoveredModels.filter(
      (m) => m.modelId.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
    );
  });

  const selectedDiscoveredCount = $derived(
    Object.values(selectedDiscovered).filter(Boolean).length,
  );

  function providerStatusInfo(provider: ProviderConfig): { label: string; ok: boolean } {
    void aiConfigStore.keyRevision;
    if (!provider.enabled) return { label: 'Đã tắt', ok: false };
    if (provider.kind === 'vertex') {
      return APP_MODE === 'firebase_auth'
        ? { label: 'Firebase Auth', ok: true }
        : { label: 'Cần firebase_auth', ok: false };
    }
    const hasKey = Boolean(resolveProviderApiKey(provider.id));
    if (provider.isCustom) {
      if (!provider.baseUrl) return { label: 'Chưa có Base URL', ok: false };
      return hasKey ? { label: 'URL + API Key', ok: true } : { label: 'URL (không key)', ok: true };
    }
    return hasKey ? { label: 'Đã có API Key', ok: true } : { label: 'Chưa có API Key', ok: false };
  }

  async function handleSaveKey(provider: ProviderConfig) {
    savingKey = { ...savingKey, [provider.id]: true };
    try {
      const value = (keyDrafts[provider.id] ?? '').trim();
      const { syncedVault } = await aiConfigStore.saveProviderKey(provider.id, value);
      if (provider.id === 'google') {
        onToast?.(
          value
            ? syncedVault
              ? 'Đã lưu khóa Google AI Studio (localStorage + Firestore Vault) cho Chat & Vector Embedding.'
              : 'Đã lưu khóa Google AI Studio trong trình duyệt cho Chat & Vector Embedding.'
            : 'Đã xóa khóa Google AI Studio.',
        );
      } else {
        onToast?.(
          value
            ? `Đã lưu API Key cho ${provider.label} trong localStorage trình duyệt.`
            : `Đã xóa API Key của ${provider.label}.`,
        );
      }
    } catch (error) {
      onToast?.(`Không thể lưu khóa: ${(error as Error).message}`);
    } finally {
      savingKey = { ...savingKey, [provider.id]: false };
    }
  }

  function handleSaveBaseUrl(provider: ProviderConfig) {
    try {
      aiConfigStore.updateProvider(provider.id, { baseUrl: baseUrlDrafts[provider.id] ?? '' });
      onToast?.(`Đã cập nhật Base URL cho ${provider.label}.`);
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  async function handleTestConnection(provider: ProviderConfig) {
    testingProvider = { ...testingProvider, [provider.id]: true };
    try {
      // Save unsaved baseUrl draft before testing custom/openrouter endpoints
      const meta = getProviderMetadata(provider);
      if (meta.allowBaseUrlEdit && (baseUrlDrafts[provider.id] ?? '').trim() !== (provider.baseUrl ?? '')) {
        aiConfigStore.updateProvider(provider.id, { baseUrl: baseUrlDrafts[provider.id] ?? '' });
      }
      const res = await aiConfigStore.testProviderConnection(provider.id);
      testResults = { ...testResults, [provider.id]: res };
    } catch (error) {
      testResults = {
        ...testResults,
        [provider.id]: { ok: false, message: (error as Error).message },
      };
    } finally {
      testingProvider = { ...testingProvider, [provider.id]: false };
    }
  }

  function handleAddCustomProvider(event: SubmitEvent) {
    event.preventDefault();
    try {
      const created = aiConfigStore.addCustomProvider({
        label: newCustomLabel,
        baseUrl: newCustomBaseUrl,
        defaultModelId: newCustomDefaultModel,
      });
      newCustomLabel = '';
      newCustomBaseUrl = '';
      newCustomDefaultModel = '';
      showAddCustomProvider = false;
      onToast?.(`Đã thêm endpoint "${created.label}".`);
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  function handleRemoveCustomProvider(provider: ProviderConfig) {
    if (!window.confirm(`Xóa endpoint "${provider.label}" và các model thuộc endpoint này?`)) return;
    try {
      aiConfigStore.removeCustomProvider(provider.id);
      onToast?.(`Đã xóa endpoint "${provider.label}".`);
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  function openNewModelForm() {
    editingModelId = null;
    modelFormProvider =
      modelFilterProvider !== 'all' ? modelFilterProvider : defaults.providerId;
    modelFormModelId = '';
    modelFormLabel = '';
    modelFormDesc = '';
    modelFormVision = false;
    modelFormReasoning = false;
    modelFormMaxContext = '';
    showAddModelForm = true;
  }

  function openEditModelForm(entry: ModelEntry) {
    editingModelId = entry.id;
    modelFormProvider = entry.providerId;
    modelFormModelId = entry.modelId;
    modelFormLabel = entry.label;
    modelFormDesc = entry.description ?? '';
    modelFormVision = Boolean(entry.capabilities?.vision);
    modelFormReasoning = Boolean(entry.capabilities?.reasoning);
    modelFormMaxContext = entry.capabilities?.maxContext ? String(entry.capabilities.maxContext) : '';
    showAddModelForm = true;
  }

  function handleSubmitModelForm(event: SubmitEvent) {
    event.preventDefault();
    const parsedMaxCtx = modelFormMaxContext.trim() ? Number(modelFormMaxContext.trim()) : undefined;
    if (parsedMaxCtx !== undefined && (!Number.isInteger(parsedMaxCtx) || parsedMaxCtx <= 0)) {
      onToast?.('Max context phải là số nguyên dương (VD: 128000).');
      return;
    }
    const capabilities =
      modelFormVision || modelFormReasoning || parsedMaxCtx
        ? {
            vision: modelFormVision || undefined,
            reasoning: modelFormReasoning || undefined,
            maxContext: parsedMaxCtx,
          }
        : undefined;

    try {
      if (editingModelId) {
        aiConfigStore.updateModel(editingModelId, {
          providerId: modelFormProvider,
          modelId: modelFormModelId.trim(),
          label: modelFormLabel.trim() || modelFormModelId.trim(),
          description: modelFormDesc.trim() || undefined,
          capabilities,
        });
        onToast?.('Đã cập nhật thông tin model.');
      } else {
        const added = aiConfigStore.addModel({
          providerId: modelFormProvider,
          modelId: modelFormModelId.trim(),
          label: modelFormLabel.trim() || modelFormModelId.trim(),
          description: modelFormDesc.trim() || undefined,
          capabilities,
        });
        onToast?.(`Đã thêm model "${added.label}".`);
      }
      showAddModelForm = false;
      editingModelId = null;
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  async function handleFetchRemoteModels() {
    fetchingModels = true;
    fetchModelsError = '';
    discoveredModels = [];
    selectedDiscovered = {};
    try {
      const list = await aiConfigStore.fetchProviderModels(fetchModelsProvider);
      discoveredModels = list;
      if (!list.length) {
        fetchModelsError = 'Nhà cung cấp không trả về model nào.';
      }
    } catch (error) {
      fetchModelsError = (error as Error).message;
    } finally {
      fetchingModels = false;
    }
  }

  function handleAddSelectedDiscovered() {
    const chosen = discoveredModels.filter((m) => selectedDiscovered[m.modelId]);
    if (!chosen.length) return;
    for (const item of chosen) {
      aiConfigStore.addModel({
        providerId: fetchModelsProvider,
        modelId: item.modelId,
        label: item.label,
        description: item.description,
      });
    }
    onToast?.(`Đã thêm ${chosen.length} model vào danh mục.`);
    discoveredModels = [];
    selectedDiscovered = {};
  }

  function handleDefaultProviderChange(event: Event) {
    const providerId = (event.currentTarget as HTMLSelectElement).value;
    const fallbackModel = aiConfigStore.getDefaultModelForProvider(providerId)?.modelId ?? '';
    aiConfigStore.updateDefaults({
      providerId,
      modelId: fallbackModel || defaults.modelId,
      activeProfileId: null,
    });
  }

  function handleSaveCurrentAsProfile(event: SubmitEvent) {
    event.preventDefault();
    if (!newProfileName.trim()) {
      onToast?.('Nhập tên cho profile.');
      return;
    }
    try {
      const saved = aiConfigStore.saveProfile({
        name: newProfileName.trim(),
        providerId: defaults.providerId,
        modelId: defaults.modelId,
        temperature: defaults.temperature,
        maxTokens: defaults.maxTokens,
        systemPrompt: defaults.systemPrompt,
      });
      aiConfigStore.applyProfile(saved.id);
      newProfileName = '';
      onToast?.(`Đã lưu profile "${saved.name}".`);
    } catch (error) {
      onToast?.((error as Error).message);
    }
  }

  async function handleSaveVertexLocation() {
    savingVertexLocation = true;
    try {
      await saveOwnerVault({ vertexLocation: vertexLocation.trim() || 'global' });
      onToast?.('Đã lưu vùng Vertex AI.');
    } catch (error) {
      onToast?.(`Không thể lưu vùng Vertex AI: ${(error as Error).message}`);
    } finally {
      savingVertexLocation = false;
    }
  }

  function handleMcpUrlChange() {
    saveLocalSetting('mcp-url', mcpUrl.trim());
    onToast?.('Đã lưu MCP Server URL.');
  }

  function handleToggleSkill(id: string, checked: boolean) {
    setSkillEnabled(id, checked);
    skills = listSkills();
  }

  function handleExportJson() {
    const json = aiConfigStore.exportConfigJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `theolab-ai-config-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    onToast?.('Đã xuất cấu hình AI (không bao gồm API key).');
  }

  async function handleCopyExportJson() {
    try {
      await navigator.clipboard.writeText(aiConfigStore.exportConfigJson());
      onToast?.('Đã sao chép JSON cấu hình AI (không chứa API key).');
    } catch {
      onToast?.('Không thể truy cập clipboard; hãy dùng nút Tải file JSON.');
    }
  }

  async function handleImportFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      aiConfigStore.importConfigJson(text);
      onToast?.('Đã nhập cấu hình AI thành công.');
    } catch (error) {
      onToast?.(`File cấu hình không hợp lệ: ${(error as Error).message}`);
    } finally {
      input.value = '';
    }
  }

  function handleImportPasted() {
    if (!importText.trim()) return;
    try {
      aiConfigStore.importConfigJson(importText);
      importText = '';
      showImportPaste = false;
      onToast?.('Đã nhập cấu hình AI từ JSON.');
    } catch (error) {
      onToast?.(`JSON không hợp lệ: ${(error as Error).message}`);
    }
  }

  function formatContext(tokens?: number): string {
    if (!tokens) return '';
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M ctx`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K ctx`;
    return `${tokens} ctx`;
  }
</script>

<section class="ai-settings" aria-label="Cấu hình AI">
  <header class="ai-settings-head">
    <div>
      <h3>Cấu hình AI & Nhà cung cấp</h3>
      <p class="status-line">
        Nguồn sự thật duy nhất cho Chat AI, Theon và Vector Embedding. Khóa BYOK lưu cục bộ ở
        <code>localStorage</code> — tránh lưu trên máy dùng chung.
      </p>
    </div>
  </header>

  <nav class="ai-subnav" aria-label="Nhóm cấu hình AI">
    <button type="button" class="subnav-pill" class:active={activeSection === 'providers'} onclick={() => (activeSection = 'providers')}>
      Nhà cung cấp
    </button>
    <button type="button" class="subnav-pill" class:active={activeSection === 'models'} onclick={() => (activeSection = 'models')}>
      Model ({aiConfigStore.listModels().length})
    </button>
    <button type="button" class="subnav-pill" class:active={activeSection === 'defaults'} onclick={() => (activeSection = 'defaults')}>
      Mặc định & Tham số
    </button>
    <button type="button" class="subnav-pill" class:active={activeSection === 'profiles'} onclick={() => (activeSection = 'profiles')}>
      Profile ({profiles.length})
    </button>
    <button type="button" class="subnav-pill" class:active={activeSection === 'advanced'} onclick={() => (activeSection = 'advanced')}>
      Nâng cao
    </button>
    <button type="button" class="subnav-pill" class:active={activeSection === 'backup'} onclick={() => (activeSection = 'backup')}>
      Import / Export
    </button>
  </nav>

  <!-- (a) NHÀ CUNG CẤP -->
  {#if activeSection === 'providers'}
    <div class="section-stack">
      <div class="section-bar">
        <p class="status-line">
          Quản lý API key, Base URL và kiểm tra kết nối. Bạn có thể thêm nhiều endpoint Custom tương thích OpenAI.
        </p>
        <button
          type="button"
          class="pill-action"
          onclick={() => (showAddCustomProvider = !showAddCustomProvider)}
        >
          {showAddCustomProvider ? 'Đóng form' : '＋ Thêm endpoint Custom'}
        </button>
      </div>

      {#if showAddCustomProvider}
        <form class="surface-card form-stack" onsubmit={handleAddCustomProvider}>
          <strong>Thêm endpoint Custom (OpenAI-compatible)</strong>
          <div class="field-grid">
            <label class="field-label">
              <span>Tên hiển thị</span>
              <input
                class="text-input"
                type="text"
                required
                placeholder="VD: Ollama Local, Groq, LM Studio…"
                bind:value={newCustomLabel}
              />
            </label>
            <label class="field-label">
              <span>Base URL</span>
              <input
                class="text-input"
                type="url"
                required
                placeholder="https://api.example.com/v1 hoặc http://localhost:11434/v1"
                bind:value={newCustomBaseUrl}
              />
            </label>
          </div>
          <label class="field-label">
            <span>Model ID ban đầu (tùy chọn)</span>
            <input
              class="text-input"
              type="text"
              placeholder="VD: llama-3.3-70b-versatile, qwen2.5:14b"
              bind:value={newCustomDefaultModel}
            />
          </label>
          <div class="inline-actions">
            <button type="submit" class="pill-action primary">Tạo endpoint</button>
            <button type="button" class="pill-action" onclick={() => (showAddCustomProvider = false)}>Hủy</button>
          </div>
        </form>
      {/if}

      <div class="provider-grid">
        {#each providers as provider (provider.id)}
          {@const meta = getProviderMetadata(provider)}
          {@const status = providerStatusInfo(provider)}
          {@const testResult = testResults[provider.id]}
          <article class="provider-card" class:disabled={!provider.enabled}>
            <div class="provider-head">
              <div class="provider-title-block">
                <div class="provider-name-row">
                  <strong>{provider.label}</strong>
                  <span class="kind-badge">{provider.kind}</span>
                  <span class="status-badge" class:ok={status.ok}>{status.label}</span>
                </div>
                <p class="status-line">{meta.authDescription}</p>
              </div>
              <div class="provider-head-actions">
                <label class="toggle-inline">
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onchange={(e) =>
                      aiConfigStore.updateProvider(provider.id, {
                        enabled: (e.currentTarget as HTMLInputElement).checked,
                      })}
                  />
                  <span>Bật</span>
                </label>
                {#if !isBuiltinProviderId(provider.id)}
                  <button
                    type="button"
                    class="pill-action danger"
                    onclick={() => handleRemoveCustomProvider(provider)}
                  >
                    Xóa
                  </button>
                {/if}
              </div>
            </div>

            {#if provider.id === 'google'}
              <div class="unified-key-note">
                <strong>Nguồn khóa duy nhất cho Google AI Studio &amp; Vector Embedding:</strong>
                Khóa này được dùng cho cả Chat / Theon (khi chọn Google AI Studio) và tạo Vector Embedding (<code>gemini-embedding-2</code>).
                {#if APP_MODE === 'firebase_auth'}
                  <label class="toggle-inline vault-sync-row">
                    <input
                      type="checkbox"
                      checked={aiConfigStore.state.syncGoogleKeyToVault}
                      onchange={(e) =>
                        aiConfigStore.setSyncGoogleKeyToVault((e.currentTarget as HTMLInputElement).checked)}
                    />
                    <span>Đồng bộ khóa này vào Firestore Vault (<code>settings/secrets</code>)</span>
                  </label>
                {/if}
              </div>
            {/if}

            {#if meta.authType !== 'firebase-auth'}
              <div class="field-row">
                <label class="field-label grow">
                  <span>API Key {meta.authType === 'optional-api-key' ? '(tùy chọn)' : ''}</span>
                  <div class="input-action-row">
                    <input
                      class="text-input"
                      type={keyVisible[provider.id] ? 'text' : 'password'}
                      autocomplete="off"
                      placeholder={meta.keyPlaceholder ?? 'Nhập API Key'}
                      value={keyDrafts[provider.id] ?? ''}
                      oninput={(e) => {
                        keyDrafts = {
                          ...keyDrafts,
                          [provider.id]: (e.currentTarget as HTMLInputElement).value,
                        };
                      }}
                    />
                    <button
                      type="button"
                      class="pill-action"
                      aria-label={keyVisible[provider.id] ? 'Ẩn khóa' : 'Hiện khóa'}
                      onclick={() => {
                        keyVisible = { ...keyVisible, [provider.id]: !keyVisible[provider.id] };
                      }}
                    >
                      {keyVisible[provider.id] ? 'Ẩn' : 'Hiện'}
                    </button>
                    <button
                      type="button"
                      class="pill-action primary"
                      disabled={savingKey[provider.id]}
                      onclick={() => handleSaveKey(provider)}
                    >
                      {savingKey[provider.id] ? 'Đang lưu…' : 'Lưu khóa'}
                    </button>
                  </div>
                </label>
              </div>
            {/if}

            {#if meta.allowBaseUrlEdit}
              <div class="field-row">
                <label class="field-label grow">
                  <span>Base URL</span>
                  <div class="input-action-row">
                    <input
                      class="text-input"
                      type="url"
                      placeholder={meta.baseUrlPlaceholder ?? 'https://api.example.com/v1'}
                      value={baseUrlDrafts[provider.id] ?? ''}
                      oninput={(e) => {
                        baseUrlDrafts = {
                          ...baseUrlDrafts,
                          [provider.id]: (e.currentTarget as HTMLInputElement).value,
                        };
                      }}
                    />
                    <button
                      type="button"
                      class="pill-action"
                      onclick={() => handleSaveBaseUrl(provider)}
                    >
                      Lưu URL
                    </button>
                  </div>
                </label>
              </div>
            {/if}

            <div class="provider-footer">
              <button
                type="button"
                class="pill-action"
                disabled={testingProvider[provider.id]}
                onclick={() => handleTestConnection(provider)}
              >
                {testingProvider[provider.id] ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
              </button>
              {#if testResult}
                <span class="test-feedback" class:ok={testResult.ok} class:err={!testResult.ok}>
                  {testResult.ok ? '✓' : '✕'} {testResult.message}
                  {#if testResult.ok && testResult.latencyMs !== undefined}
                    ({testResult.latencyMs} ms)
                  {/if}
                </span>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    </div>
  {/if}

  <!-- (b) MODEL -->
  {#if activeSection === 'models'}
    <div class="section-stack">
      <div class="info-strip">
        Các model gắn nhãn <strong>Gợi ý</strong> chỉ là dữ liệu khởi tạo mẫu (không mặc định là bản mới nhất). Hãy thêm mới, sửa Model ID hoặc tải trực tiếp từ nhà cung cấp của bạn.
      </div>

      <div class="model-toolbar">
        <select class="select-input compact-select" bind:value={modelFilterProvider} aria-label="Lọc theo nhà cung cấp">
          <option value="all">Tất cả nhà cung cấp</option>
          {#each providers as p (p.id)}
            <option value={p.id}>{p.label}</option>
          {/each}
        </select>
        <input
          class="text-input compact-search"
          type="search"
          placeholder="Tìm theo tên hoặc Model ID…"
          bind:value={modelSearch}
        />
        <label class="toggle-inline">
          <input type="checkbox" bind:checked={showHiddenModels} />
          <span>Hiện model đã ẩn</span>
        </label>
        <button type="button" class="pill-action primary" onclick={openNewModelForm}>
          ＋ Thêm model
        </button>
      </div>

      <!-- Discover models from provider /models endpoint -->
      <div class="surface-card discover-box">
        <div class="discover-row">
          <select class="select-input compact-select" bind:value={fetchModelsProvider} aria-label="Chọn nhà cung cấp để tải model">
            {#each providers.filter((p) => getProviderMetadata(p).supportsModelList) as p (p.id)}
              <option value={p.id}>{p.label}</option>
            {/each}
          </select>
          <button
            type="button"
            class="pill-action"
            disabled={fetchingModels}
            onclick={handleFetchRemoteModels}
          >
            {fetchingModels ? 'Đang tải danh sách…' : '↻ Tải danh sách model'}
          </button>
        </div>

        {#if fetchModelsError}
          <p class="test-feedback err">{fetchModelsError}</p>
        {/if}

        {#if discoveredModels.length > 0}
          <div class="discovered-panel">
            <div class="discover-row">
              <input
                class="text-input compact-search"
                type="search"
                placeholder="Lọc trong {discoveredModels.length} model vừa tải…"
                bind:value={discoveredFilter}
              />
              <button
                type="button"
                class="pill-action primary"
                disabled={selectedDiscoveredCount === 0}
                onclick={handleAddSelectedDiscovered}
              >
                Thêm {selectedDiscoveredCount} model đã chọn
              </button>
              <button
                type="button"
                class="pill-action"
                onclick={() => {
                  discoveredModels = [];
                  selectedDiscovered = {};
                }}
              >
                Đóng
              </button>
            </div>
            <div class="discovered-list">
              {#each filteredDiscoveredModels.slice(0, 120) as item (item.modelId)}
                <label class="discovered-item">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedDiscovered[item.modelId])}
                    onchange={(e) => {
                      selectedDiscovered = {
                        ...selectedDiscovered,
                        [item.modelId]: (e.currentTarget as HTMLInputElement).checked,
                      };
                    }}
                  />
                  <span class="discovered-copy">
                    <strong>{item.label}</strong>
                    <code>{item.modelId}</code>
                  </span>
                </label>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      {#if showAddModelForm}
        <form class="surface-card form-stack" onsubmit={handleSubmitModelForm}>
          <strong>{editingModelId ? 'Sửa thông tin model' : 'Thêm model mới'}</strong>
          <div class="field-grid">
            <label class="field-label">
              <span>Nhà cung cấp</span>
              <select class="select-input" bind:value={modelFormProvider}>
                {#each providers as p (p.id)}
                  <option value={p.id}>{p.label}</option>
                {/each}
              </select>
            </label>
            <label class="field-label">
              <span>Model ID (gửi API)</span>
              <input
                class="text-input"
                type="text"
                required
                placeholder="VD: gemini-2.5-pro, gpt-4.1, claude-sonnet-4-20250514"
                bind:value={modelFormModelId}
              />
            </label>
            <label class="field-label">
              <span>Tên hiển thị</span>
              <input
                class="text-input"
                type="text"
                required
                placeholder="VD: Gemini 2.5 Pro"
                bind:value={modelFormLabel}
              />
            </label>
            <label class="field-label">
              <span>Ngữ cảnh tối đa (tokens · tùy chọn)</span>
              <input
                class="text-input"
                type="number"
                min="1024"
                step="1024"
                placeholder="VD: 128000"
                bind:value={modelFormMaxContext}
              />
            </label>
          </div>
          <label class="field-label">
            <span>Mô tả ngắn (tùy chọn)</span>
            <input class="text-input" type="text" placeholder="Ghi chú mục đích sử dụng" bind:value={modelFormDesc} />
          </label>
          <div class="inline-actions">
            <label class="toggle-inline">
              <input type="checkbox" bind:checked={modelFormVision} />
              <span>Hỗ trợ Vision (ảnh)</span>
            </label>
            <label class="toggle-inline">
              <input type="checkbox" bind:checked={modelFormReasoning} />
              <span>Hỗ trợ Reasoning (suy luận)</span>
            </label>
          </div>
          <div class="inline-actions">
            <button type="submit" class="pill-action primary">
              {editingModelId ? 'Lưu thay đổi' : 'Thêm vào danh mục'}
            </button>
            <button
              type="button"
              class="pill-action"
              onclick={() => {
                showAddModelForm = false;
                editingModelId = null;
              }}
            >
              Hủy
            </button>
          </div>
        </form>
      {/if}

      <div class="model-list">
        {#each filteredModels as entry (entry.id)}
          {@const isDefault =
            defaults.providerId === entry.providerId && defaults.modelId === entry.modelId}
          <article class="model-row" class:is-hidden={entry.hidden}>
            <div class="model-main">
              <div class="model-title-line">
                <strong>{entry.label}</strong>
                <code>{entry.modelId}</code>
                <span class="kind-badge">{aiConfigStore.getProviderLabel(entry.providerId)}</span>
                {#if isDefault}
                  <span class="status-badge ok">Mặc định</span>
                {/if}
                {#if entry.userAdded}
                  <span class="kind-badge">Tự thêm</span>
                {:else}
                  <span class="kind-badge">Gợi ý</span>
                {/if}
                {#if entry.hidden}
                  <span class="kind-badge muted">Đang ẩn</span>
                {/if}
              </div>
              {#if entry.description || entry.capabilities}
                <div class="model-meta-line">
                  {#if entry.description}
                    <span class="status-line">{entry.description}</span>
                  {/if}
                  {#if entry.capabilities?.vision}
                    <span class="cap-tag">Vision</span>
                  {/if}
                  {#if entry.capabilities?.reasoning}
                    <span class="cap-tag">Reasoning</span>
                  {/if}
                  {#if entry.capabilities?.maxContext}
                    <span class="cap-tag">{formatContext(entry.capabilities.maxContext)}</span>
                  {/if}
                </div>
              {/if}
            </div>
            <div class="model-actions">
              {#if !isDefault && !entry.hidden}
                <button
                  type="button"
                  class="pill-action"
                  onclick={() => {
                    aiConfigStore.setDefaultModel(entry.providerId, entry.modelId);
                    onToast?.(`Đã đặt "${entry.label}" làm mặc định.`);
                  }}
                >
                  Đặt mặc định
                </button>
              {/if}
              <button type="button" class="pill-action" onclick={() => openEditModelForm(entry)}>
                Sửa
              </button>
              <button
                type="button"
                class="pill-action"
                onclick={() => aiConfigStore.setModelHidden(entry.id, !entry.hidden)}
              >
                {entry.hidden ? 'Hiện' : 'Ẩn'}
              </button>
              {#if entry.userAdded}
                <button
                  type="button"
                  class="pill-action danger"
                  onclick={() => {
                    aiConfigStore.removeModel(entry.id);
                    onToast?.(`Đã xóa model "${entry.label}".`);
                  }}
                >
                  Xóa
                </button>
              {/if}
            </div>
          </article>
        {:else}
          <p class="status-line">Không có model nào khớp bộ lọc hiện tại.</p>
        {/each}
      </div>
    </div>
  {/if}

  <!-- (c) MẶC ĐỊNH & THAM SỐ -->
  {#if activeSection === 'defaults'}
    <div class="surface-card form-stack">
      <div class="field-grid">
        <label class="field-label">
          <span>Nhà cung cấp mặc định</span>
          <select class="select-input" value={defaults.providerId} onchange={handleDefaultProviderChange}>
            {#each providers.filter((p) => p.enabled) as p (p.id)}
              <option value={p.id}>{p.label}</option>
            {/each}
          </select>
        </label>

        <label class="field-label">
          <span>Model mặc định</span>
          <select
            class="select-input"
            value={modelsForDefaultProvider.some((m) => m.modelId === defaults.modelId) ? defaults.modelId : '__manual__'}
            onchange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              if (v !== '__manual__') {
                aiConfigStore.updateDefaults({ modelId: v, activeProfileId: null });
              }
            }}
          >
            {#each modelsForDefaultProvider as m (m.id)}
              <option value={m.modelId}>{m.label} ({m.modelId})</option>
            {/each}
            <option value="__manual__">Model ID nhập tay bên dưới…</option>
          </select>
        </label>
      </div>

      <label class="field-label">
        <span>Model ID mặc định (nhập trực tiếp nếu chưa có trong danh mục)</span>
        <input
          class="text-input"
          type="text"
          value={defaults.modelId}
          onchange={(e) => {
            const val = (e.currentTarget as HTMLInputElement).value.trim();
            if (val) aiConfigStore.updateDefaults({ modelId: val, activeProfileId: null });
          }}
        />
      </label>

      <div class="field-grid">
        <label class="field-label">
          <span>Độ sáng tạo (Temperature): <strong>{defaults.temperature.toFixed(2)}</strong></span>
          <input
            class="range-input"
            type="range"
            min="0"
            max="1.2"
            step="0.05"
            value={defaults.temperature}
            oninput={(e) =>
              aiConfigStore.updateDefaults({
                temperature: Number((e.currentTarget as HTMLInputElement).value),
                activeProfileId: null,
              })}
          />
        </label>

        <label class="field-label">
          <span>Max tokens (thay giới hạn 1200 mặc định cũ)</span>
          <input
            class="text-input"
            type="number"
            min="64"
            max="128000"
            step="64"
            value={defaults.maxTokens}
            onchange={(e) => {
              const n = Math.max(64, Math.min(128000, Math.round(Number((e.currentTarget as HTMLInputElement).value) || 2048)));
              aiConfigStore.updateDefaults({ maxTokens: n, activeProfileId: null });
            }}
          />
        </label>
      </div>

      <details class="collapsible-panel">
        <summary>System prompt mặc định (tùy chọn · thu gọn mặc định)</summary>
        <div class="collapsible-body">
          <textarea
            class="text-input prompt-textarea"
            rows="4"
            placeholder="Chỉ dẫn hệ thống bổ sung cho mọi phiên chat AI mới…"
            value={defaults.systemPrompt}
            onchange={(e) =>
              aiConfigStore.updateDefaults({
                systemPrompt: (e.currentTarget as HTMLTextAreaElement).value,
                activeProfileId: null,
              })}
          ></textarea>
        </div>
      </details>
    </div>
  {/if}

  <!-- (d) PROFILE -->
  {#if activeSection === 'profiles'}
    <div class="section-stack">
      <p class="status-line">
        Lưu và chuyển nhanh giữa các bộ cấu hình (nhà cung cấp, model, temperature, max tokens, system prompt).
      </p>

      <div class="profile-grid">
        {#each profiles as profile (profile.id)}
          {@const isActive = defaults.activeProfileId === profile.id}
          <article class="provider-card" class:active-profile={isActive}>
            <div class="provider-head">
              <div>
                <div class="provider-name-row">
                  <strong>{profile.name}</strong>
                  {#if isActive}
                    <span class="status-badge ok">Đang áp dụng</span>
                  {/if}
                </div>
                <p class="status-line">
                  {aiConfigStore.getProviderLabel(profile.providerId)} · <code>{profile.modelId}</code> · T={profile.temperature} · max {profile.maxTokens}
                </p>
                {#if profile.systemPrompt}
                  <p class="status-line profile-prompt-preview">{profile.systemPrompt}</p>
                {/if}
              </div>
              <div class="inline-actions">
                <button
                  type="button"
                  class="pill-action primary"
                  onclick={() => {
                    aiConfigStore.applyProfile(profile.id);
                    onToast?.(`Đã áp dụng profile "${profile.name}".`);
                  }}
                >
                  Áp dụng
                </button>
                <button
                  type="button"
                  class="pill-action danger"
                  onclick={() => {
                    aiConfigStore.deleteProfile(profile.id);
                    onToast?.(`Đã xóa profile "${profile.name}".`);
                  }}
                >
                  Xóa
                </button>
              </div>
            </div>
          </article>
        {/each}
      </div>

      <form class="surface-card form-stack" onsubmit={handleSaveCurrentAsProfile}>
        <strong>Lưu thiết lập mặc định hiện tại thành Profile mới</strong>
        <p class="status-line">
          Sẽ lưu: {aiConfigStore.getProviderLabel(defaults.providerId)} · <code>{defaults.modelId}</code> · T={defaults.temperature.toFixed(2)} · max {defaults.maxTokens} tokens.
        </p>
        <div class="input-action-row">
          <input
            class="text-input"
            type="text"
            placeholder="VD: Ôn thi nhanh, Giải thích hóa lý sâu…"
            bind:value={newProfileName}
          />
          <button type="submit" class="pill-action primary">＋ Lưu Profile</button>
        </div>
      </form>
    </div>
  {/if}

  <!-- (e) NÂNG CAO -->
  {#if activeSection === 'advanced'}
    <div class="surface-card form-stack">
      <div class="field-row">
        <label class="field-label grow">
          <span>Vùng Vertex AI (Firebase AI Logic)</span>
          <div class="input-action-row">
            <input
              class="text-input"
              type="text"
              placeholder="global"
              bind:value={vertexLocation}
            />
            <button
              type="button"
              class="pill-action"
              disabled={savingVertexLocation}
              onclick={handleSaveVertexLocation}
            >
              {savingVertexLocation ? 'Đang lưu…' : 'Lưu vùng'}
            </button>
          </div>
        </label>
      </div>

      <div class="field-row">
        <label class="field-label grow">
          <span>MCP Server URL (HTTP/SSE)</span>
          <div class="input-action-row">
            <input
              class="text-input"
              type="url"
              placeholder="https://…"
              bind:value={mcpUrl}
              onchange={handleMcpUrlChange}
            />
            <button type="button" class="pill-action" onclick={handleMcpUrlChange}>Lưu MCP</button>
          </div>
        </label>
      </div>

      <div class="skills-box">
        <strong>Skills theo ngữ cảnh</strong>
        {#each skills as skill (skill.id)}
          <div class="setting-row">
            <label for={`ai-skill-${skill.id}`}>{skill.name}</label>
            <input
              id={`ai-skill-${skill.id}`}
              type="checkbox"
              checked={skill.enabled}
              onchange={(e) => handleToggleSkill(skill.id, (e.currentTarget as HTMLInputElement).checked)}
            />
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- (f) IMPORT / EXPORT -->
  {#if activeSection === 'backup'}
    <div class="surface-card form-stack">
      <strong>Sao lưu &amp; Chuyển cấu hình AI (JSON)</strong>
      <p class="status-line">
        File JSON xuất ra chứa danh sách nhà cung cấp (không gồm khóa), danh mục model, profile và tham số mặc định.
        <strong>Mặc định KHÔNG bao giờ xuất API key.</strong>
      </p>
      <div class="inline-actions">
        <button type="button" class="pill-action primary" onclick={handleExportJson}>
          ↓ Xuất file JSON
        </button>
        <button type="button" class="pill-action" onclick={handleCopyExportJson}>
          Sao chép JSON
        </button>
        <label class="pill-action file-label">
          ↑ Nhập file JSON
          <input type="file" accept="application/json,.json" class="sr-only-input" onchange={handleImportFile} />
        </label>
        <button type="button" class="pill-action" onclick={() => (showImportPaste = !showImportPaste)}>
          Dán JSON
        </button>
      </div>

      {#if showImportPaste}
        <textarea
          class="text-input prompt-textarea"
          rows="6"
          placeholder="Dán nội dung file JSON cấu hình AI vào đây…"
          bind:value={importText}
        ></textarea>
        <div class="inline-actions">
          <button type="button" class="pill-action primary" onclick={handleImportPasted}>Áp dụng JSON</button>
          <button type="button" class="pill-action" onclick={() => (showImportPaste = false)}>Hủy</button>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .ai-settings {
    background: rgb(255 255 255 / 66%);
    padding: 18px;
    border-radius: var(--radius-card);
    margin: 14px 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .ai-settings-head h3 {
    margin: 0 0 6px;
    font-size: 16px;
    font-weight: 600;
  }

  .ai-subnav {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 4px;
    border-radius: 16px;
    background: var(--surface-card);
  }

  .subnav-pill {
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text-secondary);
    padding: 8px 13px;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.16s ease, color 0.16s ease;
  }

  .subnav-pill:hover {
    background: var(--surface-hover);
  }

  .subnav-pill.active {
    background: #fff;
    color: var(--accent-solid);
    font-weight: 600;
  }

  .section-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .surface-card,
  .provider-card {
    background: var(--surface-card);
    border-radius: 18px;
    padding: 15px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .provider-card.disabled {
    opacity: 0.65;
  }

  .provider-card.active-profile {
    background: #e9f1fc;
  }

  .provider-grid,
  .profile-grid,
  .model-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .provider-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }

  .provider-title-block {
    min-width: 0;
    flex: 1;
  }

  .provider-name-row,
  .model-title-line,
  .model-meta-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .provider-head-actions,
  .inline-actions,
  .model-actions,
  .discover-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .kind-badge,
  .status-badge,
  .cap-tag {
    display: inline-flex;
    align-items: center;
    padding: 3px 9px;
    border-radius: var(--radius-pill);
    font-size: 11px;
    font-weight: 550;
    background: var(--surface-elevated);
    color: var(--text-secondary);
  }

  .kind-badge.muted {
    color: var(--text-muted);
  }

  .status-badge.ok {
    background: #e6f4ea;
    color: var(--success);
  }

  .cap-tag {
    background: #fff;
    color: var(--accent-solid);
  }

  .unified-key-note,
  .info-strip {
    background: #e9f1fc;
    color: var(--text-secondary);
    border-radius: 14px;
    padding: 10px 13px;
    font-size: 12px;
    line-height: 1.5;
  }

  .vault-sync-row {
    margin-top: 8px;
  }

  .form-stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .field-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  .field-row {
    display: flex;
    gap: 8px;
  }

  .field-label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
    color: var(--text-secondary);
    margin: 0;
  }

  .field-label.grow {
    flex: 1;
    min-width: 0;
  }

  .input-action-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .input-action-row .text-input {
    flex: 1 1 200px;
    min-width: 0;
    background: #fff;
  }

  .surface-card .text-input,
  .surface-card .select-input,
  .provider-card .text-input {
    background: #fff;
    padding: 10px 13px;
    border-radius: 13px;
    font-size: 13px;
  }

  .pill-action {
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--text-primary);
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 550;
    transition: background 0.15s ease;
    white-space: nowrap;
  }

  .pill-action:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .pill-action.primary {
    background: var(--accent-solid);
    color: #fff;
  }

  .pill-action.primary:hover:not(:disabled) {
    opacity: 0.92;
  }

  .pill-action.danger {
    color: var(--error);
  }

  .pill-action:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .toggle-inline {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
    margin: 0;
  }

  .toggle-inline input {
    accent-color: var(--accent-solid);
  }

  .provider-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

  .test-feedback {
    font-size: 12px;
    line-height: 1.4;
  }

  .test-feedback.ok {
    color: var(--success);
  }

  .test-feedback.err {
    color: var(--error);
  }

  .model-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .compact-select {
    width: auto;
    min-width: 180px;
    padding: 9px 13px;
    border-radius: 13px;
    font-size: 13px;
  }

  .compact-search {
    flex: 1 1 180px;
    min-width: 160px;
    padding: 9px 13px;
    border-radius: 13px;
    font-size: 13px;
  }

  .model-row {
    background: var(--surface-card);
    border-radius: 16px;
    padding: 12px 14px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .model-row.is-hidden {
    opacity: 0.55;
  }

  .model-main {
    min-width: 0;
    flex: 1 1 280px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .model-main code {
    font-size: 11px;
    background: var(--surface-elevated);
    padding: 2px 7px;
    border-radius: 8px;
    color: var(--text-secondary);
  }

  .discover-box {
    gap: 10px;
  }

  .discovered-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .discovered-list {
    max-height: 220px;
    overflow: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 6px;
    padding: 4px;
  }

  .discovered-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 12px;
    background: #fff;
    cursor: pointer;
    margin: 0;
  }

  .discovered-item:hover {
    background: var(--surface-hover);
  }

  .discovered-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: 12px;
  }

  .discovered-copy code {
    font-size: 10px;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  .range-input {
    width: 100%;
    accent-color: var(--accent-solid);
  }

  .collapsible-panel {
    background: #fff;
    border-radius: 14px;
    padding: 10px 14px;
  }

  .collapsible-panel summary {
    font-size: 13px;
    font-weight: 550;
  }

  .collapsible-body {
    margin-top: 10px;
  }

  .prompt-textarea {
    width: 100%;
    resize: vertical;
    font-family: inherit;
    line-height: 1.5;
  }

  .profile-prompt-preview {
    margin: 4px 0 0;
    font-style: italic;
  }

  .skills-box {
    background: #fff;
    border-radius: 14px;
    padding: 12px 14px;
  }

  .file-label {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    margin: 0;
  }

  .sr-only-input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
