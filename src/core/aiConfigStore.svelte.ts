/**
 * Reactive Svelte 5 store & service layer for TheoLab AI Configuration.
 *
 * Persistence boundary:
 * - Non-secret AI config (`providers`, `models`, `profiles`, `defaults`): persisted via `dataGateway.js`.
 * - BYOK API keys: persisted in browser-local `theolab:byok:<providerId>` via `dataGateway.js`.
 * - Unified Google AI Studio key: managed in one place; optionally synced to owner-only
 *   Firestore Vault (`settings/secrets.geminiApiKey`) when in `firebase_auth` mode, and shared
 *   explicitly between Google AI Studio chat/Theon and Vector Embedding (`gemini-embedding-2`).
 */
import { APP_MODE } from '../config/runtimeConfig.js';
import {
  getApiKey,
  getJsonSetting,
  saveApiKey,
  saveJsonSetting,
  saveLocalSetting,
} from './dataGateway.js';
import { getCachedVault, saveOwnerVault } from './secretsVault';
import {
  AiConfigStateSchema,
  type AiConfigState,
  type AiDefaults,
  type AiProfile,
  type ModelEntry,
  type ProviderConfig,
  type ProviderId,
} from '../domain/ai/schemas';
import {
  addCustomProvider,
  addModel,
  applyProfile,
  createDefaultAiConfig,
  deleteProfile,
  exportAiConfig,
  findModel,
  findProvider,
  getDefaultModelForProvider,
  getProviderLabel,
  importAiConfig,
  listModels,
  listProviders,
  mergeProviders,
  removeCustomProvider,
  removeModel,
  resolveVertexModelId,
  saveProfile,
  setDefaultModel,
  setModelHidden,
  updateDefaults,
  updateModel,
  updateProvider,
  type AddModelInput,
  type ListModelsOptions,
} from '../domain/ai/modelRegistry';
import { migrateLegacyAiSettings } from '../domain/ai/migrations';
import {
  BUILTIN_PROVIDER_CATALOG,
  isAllowedProviderBaseUrl,
  resolveOpenAiChatEndpoint,
  resolveOpenAiModelsEndpoint,
} from '../domain/ai/providerCatalog';
import { runVertexAI } from '../modules/agents/vertexProvider';

export const AI_CONFIG_STORAGE_KEY = 'theolab:ai-config:v1';

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export interface DiscoveredRemoteModel {
  modelId: string;
  label: string;
  description?: string;
}

function loadInitialAiConfig(): AiConfigState {
  if (typeof localStorage === 'undefined') {
    return createDefaultAiConfig(APP_MODE);
  }
  const stored = getJsonSetting(AI_CONFIG_STORAGE_KEY);
  if (stored) {
    const parsed = AiConfigStateSchema.safeParse(stored);
    if (parsed.success) {
      return {
        ...parsed.data,
        providers: mergeProviders(parsed.data.providers),
      };
    }
  }
  const migrated = migrateLegacyAiSettings(localStorage, { appMode: APP_MODE });
  if (migrated.migrated) {
    try {
      saveJsonSetting(AI_CONFIG_STORAGE_KEY, migrated.state);
    } catch {
      // Ignore storage quota errors in private mode.
    }
  }
  return migrated.state;
}

function classifyFetchError(error: unknown, providerLabel: string): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return `Hết thời gian chờ khi kết nối tới ${providerLabel}.`;
  }
  if (error instanceof TypeError) {
    return `Không thể kết nối tới ${providerLabel} (có thể bị chặn CORS từ trình duyệt hoặc sai địa chỉ Base URL).`;
  }
  return (error as Error)?.message || `Lỗi không xác định khi kết nối tới ${providerLabel}.`;
}

async function readHttpErrorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    message?: string;
  };
  const detail = body.error?.message ?? body.message ?? '';
  if (response.status === 401) {
    return `API key không hợp lệ hoặc đã hết hạn (HTTP 401)${detail ? `: ${detail}` : ''}.`;
  }
  if (response.status === 403) {
    return `Không có quyền truy cập endpoint này (HTTP 403)${detail ? `: ${detail}` : ''}.`;
  }
  if (response.status === 404) {
    return `Không tìm thấy endpoint hoặc model (HTTP 404)${detail ? `: ${detail}` : ''}.`;
  }
  if (response.status === 429) {
    return `Vượt giới hạn gọi API / hết hạn mức (HTTP 429)${detail ? `: ${detail}` : ''}.`;
  }
  return `Lỗi HTTP ${response.status}${detail ? `: ${detail}` : ''}.`;
}

/**
 * Single canonical resolver for provider API keys across Chat, Theon, and Settings.
 * - `google`: reads unified Google AI Studio key (BYOK localStorage or synced Firestore Vault).
 * - `vertex`: uses Firebase Auth (no API key needed; optional vault.vertexApiKey preserved).
 * - others (including custom OpenAI-compatible providers): reads `theolab:byok:<providerId>`.
 */
export function resolveProviderApiKey(providerId: ProviderId): string {
  if (providerId === 'google') {
    const localKey = typeof localStorage !== 'undefined' ? getApiKey('google') : '';
    const vaultKey = getCachedVault().geminiApiKey ?? '';
    return localKey || vaultKey || '';
  }
  if (providerId === 'vertex') {
    return getCachedVault().vertexApiKey || (typeof localStorage !== 'undefined' ? getApiKey('vertex') : '') || '';
  }
  return typeof localStorage !== 'undefined' ? getApiKey(providerId) : '';
}

/**
 * Single canonical resolver for Vector Embedding (`gemini-embedding-2`).
 * Explicitly shares the Google AI Studio key so there are never two conflicting inputs.
 */
export function resolveEmbeddingApiKey(): string {
  return resolveProviderApiKey('google');
}

class AiConfigStore {
  state = $state<AiConfigState>(loadInitialAiConfig());
  /** Monotonic counter bumped whenever BYOK keys or Vault change so UI derives reactively. */
  keyRevision = $state(0);

  private listeners = new Set<(next: AiConfigState) => void>();

  onChange(cb: (next: AiConfigState) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private commit(next: AiConfigState) {
    this.state = {
      ...next,
      providers: mergeProviders(next.providers),
    };
    try {
      saveJsonSetting(AI_CONFIG_STORAGE_KEY, this.state);
      // Mirror minimal legacy keys so any older utility reading them stays coherent.
      saveLocalSetting('provider', this.state.defaults.providerId);
      saveLocalSetting(`model:${this.state.defaults.providerId}`, this.state.defaults.modelId);
      const customProvider = findProvider(this.state, 'custom');
      if (customProvider?.baseUrl !== undefined) {
        saveLocalSetting('custom-endpoint', customProvider.baseUrl);
      }
    } catch {
      // Ignore storage quota restrictions.
    }
    this.listeners.forEach((cb) => cb(this.state));
  }

  notifyKeyChanged() {
    this.keyRevision += 1;
  }

  /**
   * Unifies any legacy key stored only in Firestore Vault (`vault.geminiApiKey`)
   * with the canonical Google AI Studio key view without overwriting user edits.
   */
  syncFromVault() {
    this.keyRevision += 1;
  }

  get providers(): ProviderConfig[] {
    return listProviders(this.state);
  }

  get enabledProviders(): ProviderConfig[] {
    return listProviders(this.state, { onlyEnabled: true });
  }

  get defaults(): AiDefaults {
    return this.state.defaults;
  }

  get profiles(): AiProfile[] {
    return this.state.profiles;
  }

  getProvider(providerId: ProviderId): ProviderConfig | undefined {
    return findProvider(this.state, providerId);
  }

  getProviderLabel(providerId: ProviderId): string {
    return getProviderLabel(this.state, providerId);
  }

  listModels(options: ListModelsOptions = {}): ModelEntry[] {
    return listModels(this.state, options);
  }

  findModel(providerId: ProviderId, modelId: string): ModelEntry | undefined {
    return findModel(this.state, providerId, modelId);
  }

  getDefaultModelForProvider(providerId: ProviderId): ModelEntry | undefined {
    return getDefaultModelForProvider(this.state, providerId);
  }

  isProviderConfigured(providerId: ProviderId): boolean {
    // Reference keyRevision so Svelte 5 deriveds re-evaluate when keys are saved.
    void this.keyRevision;
    const provider = this.getProvider(providerId);
    if (!provider || !provider.enabled) return false;
    if (provider.kind === 'vertex') {
      return APP_MODE === 'firebase_auth';
    }
    if (provider.kind === 'openai-compatible' && provider.isCustom) {
      return Boolean(provider.baseUrl && isAllowedProviderBaseUrl(provider.baseUrl));
    }
    return Boolean(resolveProviderApiKey(providerId));
  }

  async saveProviderKey(providerId: ProviderId, key: string): Promise<{ syncedVault: boolean }> {
    const trimmed = key.trim();
    saveApiKey(providerId, trimmed);
    let syncedVault = false;
    if (providerId === 'google') {
      const vault = getCachedVault();
      const shouldSyncVault =
        (APP_MODE === 'firebase_auth' && this.state.syncGoogleKeyToVault)
        || (trimmed === '' && Boolean(vault.geminiApiKey));
      if (shouldSyncVault) {
        await saveOwnerVault({ geminiApiKey: trimmed });
        syncedVault = true;
      }
    }
    this.keyRevision += 1;
    return { syncedVault };
  }

  setSyncGoogleKeyToVault(enabled: boolean) {
    this.commit({ ...this.state, syncGoogleKeyToVault: enabled });
  }

  addCustomProvider(input: { label: string; baseUrl: string; defaultModelId?: string }): ProviderConfig {
    if (!isAllowedProviderBaseUrl(input.baseUrl)) {
      throw new Error('Base URL phải dùng https:// (hoặc http://localhost / http://127.0.0.1).');
    }
    const { state, provider } = addCustomProvider(this.state, input);
    this.commit(state);
    return provider;
  }

  updateProvider(providerId: ProviderId, patch: Partial<Pick<ProviderConfig, 'label' | 'baseUrl' | 'enabled'>>) {
    if (patch.baseUrl !== undefined && patch.baseUrl.trim() !== '' && !isAllowedProviderBaseUrl(patch.baseUrl)) {
      throw new Error('Base URL phải dùng https:// (hoặc http://localhost / http://127.0.0.1).');
    }
    this.commit(updateProvider(this.state, providerId, patch));
  }

  removeCustomProvider(providerId: ProviderId) {
    saveApiKey(providerId, '');
    this.commit(removeCustomProvider(this.state, providerId));
    this.keyRevision += 1;
  }

  addModel(input: AddModelInput): ModelEntry {
    const { state, entry } = addModel(this.state, input);
    this.commit(state);
    return entry;
  }

  updateModel(
    id: string,
    patch: Partial<Pick<ModelEntry, 'providerId' | 'modelId' | 'label' | 'description' | 'capabilities' | 'hidden'>>,
  ) {
    this.commit(updateModel(this.state, id, patch));
  }

  setModelHidden(id: string, hidden: boolean) {
    this.commit(setModelHidden(this.state, id, hidden));
  }

  removeModel(id: string) {
    this.commit(removeModel(this.state, id));
  }

  setDefaultModel(providerId: ProviderId, modelId: string) {
    this.commit(setDefaultModel(this.state, providerId, modelId));
  }

  updateDefaults(patch: Partial<AiDefaults>) {
    this.commit(updateDefaults(this.state, patch));
  }

  saveProfile(input: Omit<AiProfile, 'id'> & { id?: string }): AiProfile {
    const { state, profile } = saveProfile(this.state, input);
    this.commit(state);
    return profile;
  }

  deleteProfile(profileId: string) {
    this.commit(deleteProfile(this.state, profileId));
  }

  applyProfile(profileId: string) {
    this.commit(applyProfile(this.state, profileId));
  }

  exportConfigJson(): string {
    return JSON.stringify(exportAiConfig(this.state), null, 2);
  }

  importConfigJson(rawJson: string): AiConfigState {
    const next = importAiConfig(rawJson);
    this.commit(next);
    return this.state;
  }

  resetToDefaults() {
    this.commit(createDefaultAiConfig(APP_MODE));
  }

  /**
   * Sends a minimal request to verify connectivity & credentials for a provider.
   */
  async testProviderConnection(providerId: ProviderId): Promise<ProviderTestResult> {
    const provider = this.getProvider(providerId);
    if (!provider) return { ok: false, message: `Không tìm thấy nhà cung cấp "${providerId}".` };
    const started = performance.now();

    if (provider.kind === 'vertex') {
      if (APP_MODE !== 'firebase_auth') {
        return {
          ok: false,
          message: 'Vertex AI chỉ hoạt động ở chế độ firebase_auth đã đăng nhập Gmail chủ sở hữu.',
        };
      }
      try {
        const model = resolveVertexModelId(this.getDefaultModelForProvider('vertex')?.modelId);
        await runVertexAI({
          model,
          system: 'Reply with OK only.',
          prompt: 'ping',
          temperature: 0,
          maxTokens: 16,
          location: getCachedVault().vertexLocation || 'global',
        });
        return {
          ok: true,
          message: `Kết nối Vertex AI thành công (${model}).`,
          latencyMs: Math.round(performance.now() - started),
        };
      } catch (error) {
        return { ok: false, message: classifyFetchError(error, provider.label) };
      }
    }

    const apiKey = resolveProviderApiKey(providerId);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12_000);

    try {
      if (provider.kind === 'google') {
        if (!apiKey) return { ok: false, message: 'Hãy nhập Google AI Studio API key trước khi kiểm tra.' };
        const res = await fetch(
          `${BUILTIN_PROVIDER_CATALOG.google.defaultBaseUrl}/models?pageSize=1`,
          {
            method: 'GET',
            headers: { 'x-goog-api-key': apiKey },
            signal: controller.signal,
          },
        );
        if (!res.ok) return { ok: false, message: await readHttpErrorMessage(res) };
        return {
          ok: true,
          message: 'Kết nối Google AI Studio thành công (hợp lệ cho cả Chat & Vector Embedding).',
          latencyMs: Math.round(performance.now() - started),
        };
      }

      if (provider.kind === 'anthropic') {
        if (!apiKey) return { ok: false, message: 'Hãy nhập Anthropic API key trước khi kiểm tra.' };
        const res = await fetch(`${BUILTIN_PROVIDER_CATALOG.anthropic.defaultBaseUrl}/models?limit=1`, {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          signal: controller.signal,
        });
        if (!res.ok) return { ok: false, message: await readHttpErrorMessage(res) };
        return {
          ok: true,
          message: 'Kết nối Anthropic thành công.',
          latencyMs: Math.round(performance.now() - started),
        };
      }

      // OpenAI / OpenRouter / Custom OpenAI-compatible
      const baseUrl = provider.baseUrl || BUILTIN_PROVIDER_CATALOG[provider.id as keyof typeof BUILTIN_PROVIDER_CATALOG]?.defaultBaseUrl || '';
      if (!baseUrl) {
        return { ok: false, message: 'Hãy nhập Base URL cho endpoint trước khi kiểm tra.' };
      }
      if (!isAllowedProviderBaseUrl(baseUrl)) {
        return { ok: false, message: 'Base URL không hợp lệ (chỉ hỗ trợ https:// hoặc http://localhost).' };
      }
      if (!provider.isCustom && !apiKey) {
        return { ok: false, message: `Hãy nhập API key cho ${provider.label} trước khi kiểm tra.` };
      }

      const headers: Record<string, string> = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const modelsUrl = resolveOpenAiModelsEndpoint(baseUrl);
      const res = await fetch(modelsUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      if (res.ok) {
        return {
          ok: true,
          message: `Kết nối ${provider.label} thành công.`,
          latencyMs: Math.round(performance.now() - started),
        };
      }

      // Some custom gateways only expose /chat/completions and return 404/405 on /models.
      if (res.status === 404 || res.status === 405) {
        const chatUrl = resolveOpenAiChatEndpoint(baseUrl);
        const testModel = this.getDefaultModelForProvider(providerId)?.modelId || 'default';
        const chatRes = await fetch(chatUrl, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: testModel,
            max_tokens: 8,
            temperature: 0,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: controller.signal,
        });
        if (!chatRes.ok) return { ok: false, message: await readHttpErrorMessage(chatRes) };
        return {
          ok: true,
          message: `Kết nối ${provider.label} thành công qua /chat/completions (${testModel}).`,
          latencyMs: Math.round(performance.now() - started),
        };
      }

      return { ok: false, message: await readHttpErrorMessage(res) };
    } catch (error) {
      return { ok: false, message: classifyFetchError(error, provider.label) };
    } finally {
      window.clearTimeout(timer);
    }
  }

  /**
   * Fetches available model IDs from the provider's `/models` endpoint when supported.
   */
  async fetchProviderModels(providerId: ProviderId): Promise<DiscoveredRemoteModel[]> {
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error(`Không tìm thấy nhà cung cấp "${providerId}".`);
    if (provider.kind === 'vertex') {
      throw new Error('Vertex AI (Firebase AI Logic) không cung cấp endpoint /models trực tiếp trên trình duyệt; hãy thêm Model ID thủ công.');
    }

    const apiKey = resolveProviderApiKey(providerId);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);

    try {
      if (provider.kind === 'google') {
        if (!apiKey) throw new Error('Hãy nhập Google AI Studio API key trước khi tải danh sách model.');
        const res = await fetch(
          `${BUILTIN_PROVIDER_CATALOG.google.defaultBaseUrl}/models?pageSize=100`,
          {
            method: 'GET',
            headers: { 'x-goog-api-key': apiKey },
            signal: controller.signal,
          },
        );
        if (!res.ok) throw new Error(await readHttpErrorMessage(res));
        const body = (await res.json()) as {
          models?: Array<{
            name?: string;
            displayName?: string;
            description?: string;
            supportedGenerationMethods?: string[];
          }>;
        };
        return (body.models ?? [])
          .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
          .map((m) => {
            const rawId = (m.name ?? '').replace(/^models\//, '').trim();
            return {
              modelId: rawId,
              label: (m.displayName ?? rawId).trim(),
              description: m.description?.trim().slice(0, 180),
            };
          })
          .filter((m) => m.modelId.length > 0);
      }

      if (provider.kind === 'anthropic') {
        if (!apiKey) throw new Error('Hãy nhập Anthropic API key trước khi tải danh sách model.');
        const res = await fetch(`${BUILTIN_PROVIDER_CATALOG.anthropic.defaultBaseUrl}/models?limit=100`, {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await readHttpErrorMessage(res));
        const body = (await res.json()) as {
          data?: Array<{ id?: string; display_name?: string }>;
        };
        return (body.data ?? [])
          .map((m) => ({
            modelId: (m.id ?? '').trim(),
            label: (m.display_name ?? m.id ?? '').trim(),
          }))
          .filter((m) => m.modelId.length > 0);
      }

      // OpenAI / OpenRouter / Custom OpenAI-compatible
      const baseUrl = provider.baseUrl || BUILTIN_PROVIDER_CATALOG[provider.id as keyof typeof BUILTIN_PROVIDER_CATALOG]?.defaultBaseUrl || '';
      if (!baseUrl || !isAllowedProviderBaseUrl(baseUrl)) {
        throw new Error(`Chưa có Base URL hợp lệ cho ${provider.label}.`);
      }
      if (!provider.isCustom && !apiKey) {
        throw new Error(`Hãy nhập API key cho ${provider.label} trước khi tải danh sách model.`);
      }
      const headers: Record<string, string> = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const res = await fetch(resolveOpenAiModelsEndpoint(baseUrl), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(await readHttpErrorMessage(res));
      const body = (await res.json()) as {
        data?: Array<{ id?: string; name?: string; description?: string }>;
      };
      return (body.data ?? [])
        .map((m) => ({
          modelId: (m.id ?? '').trim(),
          label: (m.name ?? m.id ?? '').trim(),
          description: m.description?.trim().slice(0, 180),
        }))
        .filter((m) => m.modelId.length > 0)
        .sort((a, b) => a.modelId.localeCompare(b.modelId));
    } catch (error) {
      throw new Error(classifyFetchError(error, provider.label));
    } finally {
      window.clearTimeout(timer);
    }
  }
}

export const aiConfigStore = new AiConfigStore();
