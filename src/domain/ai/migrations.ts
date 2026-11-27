/**
 * Idempotent migration from legacy TheoLab localStorage AI settings:
 * - `theolab:setting:provider`
 * - `theolab:setting:model:<provider>`
 * - `theolab:setting:custom-endpoint`
 *
 * Note: BYOK API keys (`theolab:byok:<provider>`) remain in browser localStorage
 * untouched and are NEVER copied into `AiConfigState`.
 */
import { BUILTIN_PROVIDER_IDS, type AiConfigState, type ProviderId } from './schemas';
import {
  addModel,
  createDefaultAiConfig,
  findModel,
  resolveVertexModelId,
  setDefaultModel,
  updateProvider,
} from './modelRegistry';

export interface LegacySettingStorage {
  getItem(key: string): string | null;
}

export interface AiMigrationResult {
  state: AiConfigState;
  migrated: boolean;
  legacyKeysFound: string[];
}

export function migrateLegacyAiSettings(
  storage: LegacySettingStorage,
  options: { appMode?: string } = {},
): AiMigrationResult {
  let state = createDefaultAiConfig(options.appMode ?? 'dev_mock');
  const legacyKeysFound: string[] = [];

  const legacyCustomEndpoint = storage.getItem('theolab:setting:custom-endpoint')?.trim() ?? '';
  if (legacyCustomEndpoint) {
    legacyKeysFound.push('theolab:setting:custom-endpoint');
    state = updateProvider(state, 'custom', { baseUrl: legacyCustomEndpoint, enabled: true });
  }

  for (const providerId of BUILTIN_PROVIDER_IDS) {
    const key = `theolab:setting:model:${providerId}`;
    const rawModel = storage.getItem(key)?.trim() ?? '';
    if (!rawModel) continue;
    legacyKeysFound.push(key);

    const modelId = providerId === 'vertex' ? resolveVertexModelId(rawModel) : rawModel;
    const existing = findModel(state, providerId, modelId);
    if (!existing) {
      state = addModel(state, {
        providerId,
        modelId,
        label: modelId,
        description: 'Di trú từ cấu hình cũ',
      }).state;
    }
  }

  const legacyProviderRaw = storage.getItem('theolab:setting:provider')?.trim() ?? '';
  if (legacyProviderRaw) {
    legacyKeysFound.push('theolab:setting:provider');
    const providerId: ProviderId = (BUILTIN_PROVIDER_IDS as readonly string[]).includes(legacyProviderRaw)
      ? legacyProviderRaw
      : state.defaults.providerId;
    const legacyProviderModel = storage.getItem(`theolab:setting:model:${providerId}`)?.trim();
    const resolvedModelId = legacyProviderModel
      ? (providerId === 'vertex' ? resolveVertexModelId(legacyProviderModel) : legacyProviderModel)
      : (findModel(state, providerId, state.defaults.modelId)?.modelId ??
          (providerId === 'vertex' ? 'gemini-3.8-flash' :
           providerId === 'google' ? 'gemini-2.5-flash' :
           providerId === 'openai' ? 'gpt-4.1' :
           providerId === 'anthropic' ? 'claude-sonnet-4-20250514' :
           providerId === 'openrouter' ? 'deepseek/deepseek-chat-v3-0324' : 'custom'));
    state = setDefaultModel(state, providerId, resolvedModelId);
  } else {
    // Even if provider wasn't saved, honour a legacy model saved for the default provider.
    const defaultModelOverride = storage.getItem(`theolab:setting:model:${state.defaults.providerId}`)?.trim();
    if (defaultModelOverride) {
      const resolved =
        state.defaults.providerId === 'vertex'
          ? resolveVertexModelId(defaultModelOverride)
          : defaultModelOverride;
      state = setDefaultModel(state, state.defaults.providerId, resolved);
    }
  }

  return {
    state,
    migrated: legacyKeysFound.length > 0,
    legacyKeysFound,
  };
}
