/**
 * Framework-free AI model, provider, and profile registry (Single Source of Truth).
 *
 * Seed models are editable suggestions (not assumed to be the latest release).
 * User additions, edits, and hide flags are merged deterministically on top of seeds.
 */
import { slugify } from '../content/ids';
import {
  AiConfigExportSchema,
  AiConfigStateSchema,
  AiProfileSchema,
  ModelEntrySchema,
  ProviderConfigSchema,
  type AiConfigExport,
  type AiConfigState,
  type AiDefaults,
  type AiProfile,
  type ModelCapabilities,
  type ModelEntry,
  type ProviderConfig,
  type ProviderId,
} from './schemas';
import {
  BUILTIN_PROVIDER_CATALOG,
  createBuiltinProviders,
  isBuiltinProviderId,
} from './providerCatalog';

/** Default Vertex AI fallback model when a saved session names a retired model. */
export const DEFAULT_VERTEX_MODEL = 'gemini-3.8-flash';

/** Shut down on the Agent Platform (Vertex) API; saved sessions may still name them. */
export const RETIRED_VERTEX_MODELS = /^gemini-(2\.|3\.6)/;

export function isRetiredVertexModel(modelId: string): boolean {
  return RETIRED_VERTEX_MODELS.test(modelId.trim());
}

export function resolveVertexModelId(modelId?: string): string {
  const clean = (modelId ?? '').trim();
  if (!clean || isRetiredVertexModel(clean)) return DEFAULT_VERTEX_MODEL;
  return clean;
}

const SEED_CREATED_AT = '2026-01-01T00:00:00.000Z';

/**
 * Editable seed suggestions. Displayed clearly as suggestions in UI so users can
 * add, rename, edit, or hide any model at any time.
 */
export const SEED_MODELS: readonly ModelEntry[] = Object.freeze([
  {
    id: 'seed:vertex:gemini-3.8-flash',
    providerId: 'vertex',
    modelId: 'gemini-3.8-flash',
    label: 'Vertex AI · Gemini 3.8 Flash',
    description: 'Gợi ý mặc định · Qua Firebase AI Logic, không cần API Key',
    capabilities: { vision: true, reasoning: true, maxContext: 1_000_000 },
    userAdded: false,
    hidden: false,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: 'seed:google:gemini-2.5-flash',
    providerId: 'google',
    modelId: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'Gợi ý mặc định · Phản hồi nhanh, ôn tập hằng ngày',
    capabilities: { vision: true, reasoning: true, maxContext: 1_000_000 },
    userAdded: false,
    hidden: false,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: 'seed:google:gemini-2.5-pro',
    providerId: 'google',
    modelId: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'Gợi ý mặc định · Suy luận sâu, giải bài phức tạp',
    capabilities: { vision: true, reasoning: true, maxContext: 1_000_000 },
    userAdded: false,
    hidden: false,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: 'seed:google:gemini-2.5-flash-lite',
    providerId: 'google',
    modelId: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    description: 'Gợi ý mặc định · Tiết kiệm chi phí, phản hồi rất nhanh',
    capabilities: { vision: true, reasoning: false, maxContext: 1_000_000 },
    userAdded: false,
    hidden: false,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: 'seed:anthropic:claude-sonnet-4-20250514',
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    label: 'Claude Sonnet 4',
    description: 'Gợi ý mặc định · Phân tích dài, diễn đạt tự nhiên',
    capabilities: { vision: true, reasoning: true, maxContext: 200_000 },
    userAdded: false,
    hidden: false,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: 'seed:anthropic:claude-3-5-haiku-latest',
    providerId: 'anthropic',
    modelId: 'claude-3-5-haiku-latest',
    label: 'Claude 3.5 Haiku',
    description: 'Gợi ý mặc định · Gọn nhẹ, tốc độ cao',
    capabilities: { vision: true, reasoning: false, maxContext: 200_000 },
    userAdded: false,
    hidden: false,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: 'seed:openai:gpt-4.1',
    providerId: 'openai',
    modelId: 'gpt-4.1',
    label: 'GPT-4.1',
    description: 'Gợi ý mặc định · Học tập và giải thích đa dụng',
    capabilities: { vision: true, reasoning: false, maxContext: 1_000_000 },
    userAdded: false,
    hidden: false,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: 'seed:openai:gpt-4.1-mini',
    providerId: 'openai',
    modelId: 'gpt-4.1-mini',
    label: 'GPT-4.1 Mini',
    description: 'Gợi ý mặc định · Nhanh và cân bằng chi phí',
    capabilities: { vision: true, reasoning: false, maxContext: 1_000_000 },
    userAdded: false,
    hidden: false,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: 'seed:openai:o4-mini',
    providerId: 'openai',
    modelId: 'o4-mini',
    label: 'o4-mini',
    description: 'Gợi ý mặc định · Suy luận toán & khoa học',
    capabilities: { vision: true, reasoning: true, maxContext: 200_000 },
    userAdded: false,
    hidden: false,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: 'seed:openrouter:deepseek-v3',
    providerId: 'openrouter',
    modelId: 'deepseek/deepseek-chat-v3-0324',
    label: 'DeepSeek V3',
    description: 'Gợi ý mặc định · Nhanh, hiệu quả cho hội thoại',
    capabilities: { vision: false, reasoning: false, maxContext: 128_000 },
    userAdded: false,
    hidden: false,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: 'seed:openrouter:deepseek-r1',
    providerId: 'openrouter',
    modelId: 'deepseek/deepseek-r1',
    label: 'DeepSeek R1',
    description: 'Gợi ý mặc định · Suy luận từng bước',
    capabilities: { vision: false, reasoning: true, maxContext: 128_000 },
    userAdded: false,
    hidden: false,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: 'seed:custom:default',
    providerId: 'custom',
    modelId: 'custom',
    label: 'Custom model',
    description: 'Gợi ý mặc định · Đổi thành Model ID thực tế trên endpoint của bạn',
    capabilities: {},
    userAdded: false,
    hidden: false,
    createdAt: SEED_CREATED_AT,
  },
]);

export function createDefaultProfiles(appMode = 'dev_mock'): AiProfile[] {
  const fastProvider: ProviderId = appMode === 'firebase_auth' ? 'vertex' : 'google';
  const fastModel = fastProvider === 'vertex' ? DEFAULT_VERTEX_MODEL : 'gemini-2.5-flash';
  return [
    {
      id: 'profile-fast-solve',
      name: 'Giải bài nhanh',
      providerId: fastProvider,
      modelId: fastModel,
      temperature: 0.25,
      maxTokens: 1600,
      systemPrompt: 'Trả lời trực diện, ngắn gọn, nêu công thức cốt lõi và đáp số rõ ràng.',
    },
    {
      id: 'profile-deep-reasoning',
      name: 'Suy luận sâu',
      providerId: 'google',
      modelId: 'gemini-2.5-pro',
      temperature: 0.2,
      maxTokens: 4096,
      systemPrompt: 'Phân tích bản chất hóa học/toán học theo từng bước, kiểm tra điều kiện áp dụng và đơn vị.',
    },
  ];
}

export function createDefaultAiConfig(appMode = 'dev_mock'): AiConfigState {
  const defaultProviderId: ProviderId = appMode === 'firebase_auth' ? 'vertex' : 'google';
  const defaultModelId = defaultProviderId === 'vertex' ? DEFAULT_VERTEX_MODEL : 'gemini-2.5-flash';
  return AiConfigStateSchema.parse({
    version: 1,
    providers: createBuiltinProviders(),
    models: [],
    profiles: createDefaultProfiles(appMode),
    defaults: {
      providerId: defaultProviderId,
      modelId: defaultModelId,
      temperature: 0.3,
      maxTokens: 2048,
      systemPrompt: '',
      activeProfileId: null,
    },
    syncGoogleKeyToVault: true,
  });
}

function foldVietnamese(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

/**
 * Ensures all built-in providers always exist while preserving user-edited fields
 * and additional custom OpenAI-compatible providers.
 */
export function mergeProviders(storedProviders: readonly ProviderConfig[]): ProviderConfig[] {
  const builtins = createBuiltinProviders();
  const byId = new Map<string, ProviderConfig>();
  for (const builtin of builtins) {
    byId.set(builtin.id, { ...builtin });
  }
  for (const candidate of storedProviders) {
    const existing = byId.get(candidate.id);
    if (existing) {
      byId.set(candidate.id, {
        ...existing,
        label: candidate.label || existing.label,
        baseUrl: candidate.baseUrl ?? existing.baseUrl,
        enabled: candidate.enabled,
      });
    } else {
      byId.set(candidate.id, { ...candidate, isCustom: true });
    }
  }
  return [...byId.values()];
}

/**
 * Merges editable seed models with stored overrides and user-added entries.
 */
export function mergeModels(
  storedModels: readonly ModelEntry[],
  seeds: readonly ModelEntry[] = SEED_MODELS,
): ModelEntry[] {
  const map = new Map<string, ModelEntry>();
  for (const seed of seeds) {
    map.set(seed.id, {
      ...seed,
      capabilities: seed.capabilities ? { ...seed.capabilities } : undefined,
    });
  }
  for (const entry of storedModels) {
    const existing = map.get(entry.id);
    if (existing) {
      map.set(entry.id, {
        ...existing,
        ...entry,
        capabilities: entry.capabilities ? { ...entry.capabilities } : existing.capabilities,
      });
    } else {
      map.set(entry.id, {
        ...entry,
        capabilities: entry.capabilities ? { ...entry.capabilities } : undefined,
      });
    }
  }
  return [...map.values()];
}

export interface ListModelsOptions {
  providerId?: ProviderId;
  includeHidden?: boolean;
  query?: string;
  onlyEnabledProviders?: boolean;
}

export function listProviders(state: AiConfigState, { onlyEnabled = false } = {}): ProviderConfig[] {
  const providers = mergeProviders(state.providers);
  return onlyEnabled ? providers.filter((p) => p.enabled) : providers;
}

export function findProvider(state: AiConfigState, providerId: ProviderId): ProviderConfig | undefined {
  return listProviders(state).find((p) => p.id === providerId);
}

export function listModels(state: AiConfigState, options: ListModelsOptions = {}): ModelEntry[] {
  const providers = mergeProviders(state.providers);
  const enabledProviderIds = new Set(providers.filter((p) => p.enabled).map((p) => p.id));
  const providerLabelById = new Map(providers.map((p) => [p.id, p.label]));

  const merged = mergeModels(state.models);
  const q = options.query ? foldVietnamese(options.query.trim()) : '';

  return merged.filter((entry) => {
    if (options.providerId && entry.providerId !== options.providerId) return false;
    if (!options.includeHidden && entry.hidden) return false;
    if (options.onlyEnabledProviders && !enabledProviderIds.has(entry.providerId)) return false;
    if (q) {
      const providerLabel = providerLabelById.get(entry.providerId) ?? entry.providerId;
      const hay = foldVietnamese(`${entry.label} ${entry.modelId} ${entry.description ?? ''} ${providerLabel}`);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function findModel(
  state: AiConfigState,
  providerId: ProviderId,
  modelId: string,
): ModelEntry | undefined {
  return mergeModels(state.models).find(
    (entry) => entry.providerId === providerId && entry.modelId === modelId,
  );
}

export function getDefaultModelForProvider(state: AiConfigState, providerId: ProviderId): ModelEntry | undefined {
  if (state.defaults.providerId === providerId) {
    const exact = findModel(state, providerId, state.defaults.modelId);
    if (exact && !exact.hidden) return exact;
  }
  const visible = listModels(state, { providerId, includeHidden: false });
  return visible[0] ?? listModels(state, { providerId, includeHidden: true })[0];
}

export interface AddModelInput {
  providerId: ProviderId;
  modelId: string;
  label: string;
  description?: string;
  capabilities?: ModelCapabilities;
  id?: string;
}

export function addModel(state: AiConfigState, input: AddModelInput): { state: AiConfigState; entry: ModelEntry } {
  const merged = mergeModels(state.models);
  const cleanModelId = input.modelId.trim();
  const duplicate = merged.find(
    (m) => m.providerId === input.providerId && m.modelId === cleanModelId,
  );
  if (duplicate) {
    // Unhide and update label/description if it already exists.
    const updated: ModelEntry = ModelEntrySchema.parse({
      ...duplicate,
      label: input.label.trim() || duplicate.label,
      description: input.description?.trim() ?? duplicate.description,
      capabilities: input.capabilities ?? duplicate.capabilities,
      hidden: false,
    });
    return {
      state: upsertStoredModel(state, updated),
      entry: updated,
    };
  }

  const baseId = input.id?.trim() || `user:${input.providerId}:${slugify(cleanModelId, 48)}`;
  const usedIds = new Set(merged.map((m) => m.id));
  let id = baseId;
  for (let n = 2; usedIds.has(id); n += 1) {
    id = `${baseId}-${n}`;
  }

  const entry = ModelEntrySchema.parse({
    id,
    providerId: input.providerId,
    modelId: cleanModelId,
    label: input.label.trim() || cleanModelId,
    description: input.description?.trim() || undefined,
    capabilities: input.capabilities,
    userAdded: true,
    hidden: false,
    createdAt: new Date().toISOString(),
  });

  return {
    state: upsertStoredModel(state, entry),
    entry,
  };
}

function upsertStoredModel(state: AiConfigState, entry: ModelEntry): AiConfigState {
  const nextModels = state.models.filter((m) => m.id !== entry.id);
  nextModels.push(entry);
  return { ...state, models: nextModels };
}

export function updateModel(
  state: AiConfigState,
  id: string,
  patch: Partial<Pick<ModelEntry, 'providerId' | 'modelId' | 'label' | 'description' | 'capabilities' | 'hidden'>>,
): AiConfigState {
  const existing = mergeModels(state.models).find((m) => m.id === id);
  if (!existing) throw new Error(`Không tìm thấy model "${id}".`);
  const next = ModelEntrySchema.parse({
    ...existing,
    ...patch,
    capabilities: patch.capabilities !== undefined ? patch.capabilities : existing.capabilities,
  });
  return upsertStoredModel(state, next);
}

export function setModelHidden(state: AiConfigState, id: string, hidden: boolean): AiConfigState {
  return updateModel(state, id, { hidden });
}

/**
 * Removes a user-added model permanently. For seed models, marks them hidden
 * (so seed merging will not resurrect them unexpectedly).
 */
export function removeModel(state: AiConfigState, id: string): AiConfigState {
  const existing = mergeModels(state.models).find((m) => m.id === id);
  if (!existing) return state;
  if (!existing.userAdded) {
    return setModelHidden(state, id, true);
  }
  return {
    ...state,
    models: state.models.filter((m) => m.id !== id),
  };
}

export function setDefaultModel(
  state: AiConfigState,
  providerId: ProviderId,
  modelId: string,
): AiConfigState {
  return {
    ...state,
    defaults: {
      ...state.defaults,
      providerId,
      modelId: modelId.trim(),
    },
  };
}

export function updateDefaults(
  state: AiConfigState,
  patch: Partial<AiDefaults>,
): AiConfigState {
  return {
    ...state,
    defaults: {
      ...state.defaults,
      ...patch,
    },
  };
}

export function addCustomProvider(
  state: AiConfigState,
  input: { label: string; baseUrl: string; defaultModelId?: string; id?: string },
): { state: AiConfigState; provider: ProviderConfig } {
  const providers = mergeProviders(state.providers);
  const usedIds = new Set(providers.map((p) => p.id));
  const rawSlug = slugify(input.label || 'custom', 32);
  let id = input.id?.trim() || `custom-${rawSlug}`;
  if (usedIds.has(id)) {
    for (let n = 2; ; n += 1) {
      const candidate = `${id}-${n}`;
      if (!usedIds.has(candidate)) {
        id = candidate;
        break;
      }
    }
  }
  const provider = ProviderConfigSchema.parse({
    id,
    label: input.label.trim(),
    kind: 'openai-compatible',
    baseUrl: input.baseUrl.trim(),
    enabled: true,
    isCustom: true,
  });

  let nextState: AiConfigState = {
    ...state,
    providers: [...providers, provider],
  };

  if (input.defaultModelId?.trim()) {
    nextState = addModel(nextState, {
      providerId: provider.id,
      modelId: input.defaultModelId.trim(),
      label: input.defaultModelId.trim(),
      description: `Model trên ${provider.label}`,
    }).state;
  }

  return { state: nextState, provider };
}

export function updateProvider(
  state: AiConfigState,
  providerId: ProviderId,
  patch: Partial<Pick<ProviderConfig, 'label' | 'baseUrl' | 'enabled'>>,
): AiConfigState {
  const providers = mergeProviders(state.providers);
  const nextProviders = providers.map((p) => {
    if (p.id !== providerId) return p;
    return ProviderConfigSchema.parse({
      ...p,
      ...patch,
      baseUrl: patch.baseUrl !== undefined ? (patch.baseUrl.trim() || undefined) : p.baseUrl,
    });
  });
  return { ...state, providers: nextProviders };
}

export function removeCustomProvider(state: AiConfigState, providerId: ProviderId): AiConfigState {
  if (isBuiltinProviderId(providerId)) {
    throw new Error('Không thể xóa nhà cung cấp mặc định; bạn có thể tắt nó.');
  }
  const nextProviders = mergeProviders(state.providers).filter((p) => p.id !== providerId);
  const nextModels = state.models.filter((m) => m.providerId !== providerId);
  const nextProfiles = state.profiles.filter((pr) => pr.providerId !== providerId);
  let nextDefaults = state.defaults;
  if (nextDefaults.providerId === providerId) {
    nextDefaults = {
      ...nextDefaults,
      providerId: 'google',
      modelId: 'gemini-2.5-flash',
      activeProfileId: null,
    };
  }
  return {
    ...state,
    providers: nextProviders,
    models: nextModels,
    profiles: nextProfiles,
    defaults: nextDefaults,
  };
}

export function saveProfile(
  state: AiConfigState,
  input: Omit<AiProfile, 'id'> & { id?: string },
): { state: AiConfigState; profile: AiProfile } {
  const id = input.id?.trim() || `profile-${slugify(input.name, 40)}-${Date.now().toString(36)}`;
  const profile = AiProfileSchema.parse({
    ...input,
    id,
    systemPrompt: input.systemPrompt?.trim() || undefined,
  });
  const exists = state.profiles.some((p) => p.id === profile.id);
  const nextProfiles = exists
    ? state.profiles.map((p) => (p.id === profile.id ? profile : p))
    : [...state.profiles, profile];
  return {
    state: { ...state, profiles: nextProfiles },
    profile,
  };
}

export function deleteProfile(state: AiConfigState, profileId: string): AiConfigState {
  return {
    ...state,
    profiles: state.profiles.filter((p) => p.id !== profileId),
    defaults:
      state.defaults.activeProfileId === profileId
        ? { ...state.defaults, activeProfileId: null }
        : state.defaults,
  };
}

export function applyProfile(state: AiConfigState, profileId: string): AiConfigState {
  const profile = state.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`Không tìm thấy profile "${profileId}".`);
  return {
    ...state,
    defaults: {
      ...state.defaults,
      providerId: profile.providerId,
      modelId: profile.modelId,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
      systemPrompt: profile.systemPrompt ?? '',
      activeProfileId: profile.id,
    },
  };
}

/**
 * Strips any accidental secret fields and produces a portable JSON export
 * that NEVER contains API keys.
 */
export function exportAiConfig(state: AiConfigState): AiConfigExport {
  const cleanConfig = AiConfigStateSchema.parse({
    version: 1,
    providers: mergeProviders(state.providers).map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      baseUrl: p.baseUrl,
      enabled: p.enabled,
      isCustom: p.isCustom,
    })),
    models: state.models.map((m) => ({
      id: m.id,
      providerId: m.providerId,
      modelId: m.modelId,
      label: m.label,
      description: m.description,
      capabilities: m.capabilities,
      userAdded: m.userAdded,
      hidden: m.hidden,
      createdAt: m.createdAt,
    })),
    profiles: state.profiles.map((pr) => ({
      id: pr.id,
      name: pr.name,
      providerId: pr.providerId,
      modelId: pr.modelId,
      temperature: pr.temperature,
      maxTokens: pr.maxTokens,
      systemPrompt: pr.systemPrompt,
    })),
    defaults: { ...state.defaults },
    syncGoogleKeyToVault: state.syncGoogleKeyToVault,
  });

  return AiConfigExportSchema.parse({
    format: 'theolab-ai-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    includesApiKeys: false,
    config: cleanConfig,
  });
}

/**
 * Validates and imports an exported JSON config (accepts either full `AiConfigExport`
 * envelope or bare `AiConfigState`), stripping any unexpected secret keys.
 */
export function importAiConfig(rawInput: string | unknown): AiConfigState {
  const parsedJson = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
  if (!parsedJson || typeof parsedJson !== 'object') {
    throw new Error('Dữ liệu cấu hình AI không hợp lệ.');
  }
  const obj = parsedJson as Record<string, unknown>;
  const candidate = obj.format === 'theolab-ai-config' ? obj.config : obj;
  const validated = AiConfigStateSchema.parse(candidate);
  return {
    ...validated,
    providers: mergeProviders(validated.providers),
  };
}

export function getProviderLabel(state: AiConfigState, providerId: ProviderId): string {
  const found = findProvider(state, providerId);
  if (found) return found.label;
  return BUILTIN_PROVIDER_CATALOG[providerId as keyof typeof BUILTIN_PROVIDER_CATALOG]?.label ?? providerId;
}
