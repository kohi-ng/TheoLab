import { describe, expect, it } from 'vitest';
import {
  addCustomProvider,
  addModel,
  applyProfile,
  createDefaultAiConfig,
  deleteProfile,
  exportAiConfig,
  findModel,
  importAiConfig,
  isRetiredVertexModel,
  listModels,
  listProviders,
  removeCustomProvider,
  removeModel,
  resolveVertexModelId,
  saveProfile,
  SEED_MODELS,
  setDefaultModel,
  setModelHidden,
  updateModel,
} from './modelRegistry';
import { migrateLegacyAiSettings } from './migrations';
import {
  isAllowedProviderBaseUrl,
  resolveOpenAiChatEndpoint,
  resolveOpenAiModelsEndpoint,
} from './providerCatalog';
import { AiProfileSchema } from './schemas';

describe('AI model registry (Single Source of Truth)', () => {
  it('merges editable seed models with user-added models and supports add/edit/hide/remove', () => {
    let state = createDefaultAiConfig('dev_mock');
    const initial = listModels(state);
    expect(initial.length).toBe(SEED_MODELS.length);

    // Add a user model
    const added = addModel(state, {
      providerId: 'google',
      modelId: 'gemini-custom-preview',
      label: 'Gemini Thử Nghiệm',
      description: 'Model người dùng tự thêm',
      capabilities: { vision: true, reasoning: true, maxContext: 500_000 },
    });
    state = added.state;
    expect(added.entry.userAdded).toBe(true);
    expect(findModel(state, 'google', 'gemini-custom-preview')?.label).toBe('Gemini Thử Nghiệm');

    // Edit a seed model (must persist override when merged)
    state = updateModel(state, 'seed:openai:gpt-4.1', {
      label: 'GPT-4.1 (Tùy chỉnh)',
      description: 'Đã chỉnh sửa bởi người dùng',
    });
    expect(findModel(state, 'openai', 'gpt-4.1')?.label).toBe('GPT-4.1 (Tùy chỉnh)');

    // Hide a seed model: excluded from visible list, present when includeHidden=true
    state = setModelHidden(state, 'seed:openai:gpt-4.1', true);
    expect(listModels(state).some((m) => m.id === 'seed:openai:gpt-4.1')).toBe(false);
    expect(listModels(state, { includeHidden: true }).some((m) => m.id === 'seed:openai:gpt-4.1')).toBe(true);

    // Vietnamese-folded search across label/modelId/provider
    const hits = listModels(state, { query: 'thu nghiem' });
    expect(hits.map((m) => m.modelId)).toContain('gemini-custom-preview');

    // Remove user-added model permanently; removing seed hides it
    state = removeModel(state, added.entry.id);
    expect(findModel(state, 'google', 'gemini-custom-preview')).toBeUndefined();

    state = removeModel(state, 'seed:anthropic:claude-3-5-haiku-latest');
    expect(listModels(state).some((m) => m.id === 'seed:anthropic:claude-3-5-haiku-latest')).toBe(false);
    expect(listModels(state, { includeHidden: true }).some((m) => m.id === 'seed:anthropic:claude-3-5-haiku-latest')).toBe(true);
  });

  it('supports multiple custom OpenAI-compatible providers and endpoint URL helpers', () => {
    let state = createDefaultAiConfig('dev_mock');
    const ollama = addCustomProvider(state, {
      label: 'Ollama Local',
      baseUrl: 'http://localhost:11434/v1',
      defaultModelId: 'qwen2.5:14b',
    });
    state = ollama.state;

    const groq = addCustomProvider(state, {
      label: 'Groq Cloud',
      baseUrl: 'https://api.groq.com/openai/v1',
      defaultModelId: 'llama-3.3-70b-versatile',
    });
    state = groq.state;

    expect(listProviders(state).map((p) => p.id)).toEqual(
      expect.arrayContaining(['custom', ollama.provider.id, groq.provider.id]),
    );
    expect(findModel(state, ollama.provider.id, 'qwen2.5:14b')).toBeDefined();
    expect(findModel(state, groq.provider.id, 'llama-3.3-70b-versatile')).toBeDefined();

    // Remove custom provider cleans up its models and resets default if needed
    state = setDefaultModel(state, ollama.provider.id, 'qwen2.5:14b');
    state = removeCustomProvider(state, ollama.provider.id);
    expect(listProviders(state).some((p) => p.id === ollama.provider.id)).toBe(false);
    expect(state.defaults.providerId).not.toBe(ollama.provider.id);

    // Endpoint normalization
    expect(resolveOpenAiChatEndpoint('https://api.groq.com/openai/v1')).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(resolveOpenAiChatEndpoint('https://api.groq.com/openai/v1/chat/completions')).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(resolveOpenAiModelsEndpoint('https://api.groq.com/openai/v1/chat/completions')).toBe('https://api.groq.com/openai/v1/models');
    expect(isAllowedProviderBaseUrl('https://api.example.com/v1')).toBe(true);
    expect(isAllowedProviderBaseUrl('http://localhost:11434/v1')).toBe(true);
    expect(isAllowedProviderBaseUrl('http://insecure.example.com/v1')).toBe(false);
    expect(isAllowedProviderBaseUrl('javascript:alert(1)')).toBe(false);
  });

  it('preserves Vertex AI retired model guard', () => {
    expect(isRetiredVertexModel('gemini-2.5-flash')).toBe(true);
    expect(isRetiredVertexModel('gemini-3.6-pro')).toBe(true);
    expect(isRetiredVertexModel('gemini-3.8-flash')).toBe(false);
    expect(resolveVertexModelId('gemini-2.5-pro')).toBe('gemini-3.8-flash');
    expect(resolveVertexModelId('gemini-3.8-pro')).toBe('gemini-3.8-pro');
  });

  it('validates AiProfile schema and applies/deletes profiles', () => {
    expect(() =>
      AiProfileSchema.parse({
        id: 'p1',
        name: 'Bad temp',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        temperature: 5,
        maxTokens: 2048,
      }),
    ).toThrow();

    let state = createDefaultAiConfig('dev_mock');
    const saved = saveProfile(state, {
      name: 'Hóa phân tích sâu',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      temperature: 0.15,
      maxTokens: 4096,
      systemPrompt: 'Luôn kiểm tra cân bằng điện tích và cân bằng vật chất.',
    });
    state = saved.state;
    state = applyProfile(state, saved.profile.id);
    expect(state.defaults.providerId).toBe('anthropic');
    expect(state.defaults.modelId).toBe('claude-sonnet-4-20250514');
    expect(state.defaults.maxTokens).toBe(4096);
    expect(state.defaults.activeProfileId).toBe(saved.profile.id);

    state = deleteProfile(state, saved.profile.id);
    expect(state.defaults.activeProfileId).toBeNull();
  });

  it('migrates legacy localStorage keys without copying or losing user custom models', () => {
    const legacy = new Map<string, string>([
      ['theolab:setting:provider', 'openrouter'],
      ['theolab:setting:model:openrouter', 'qwen/qwen3-235b'],
      ['theolab:setting:model:vertex', 'gemini-2.5-flash'],
      ['theolab:setting:custom-endpoint', 'https://my-proxy.example.com/v1/chat/completions'],
      ['theolab:byok:openrouter', 'sk-or-secret-do-not-copy'],
    ]);
    const result = migrateLegacyAiSettings({ getItem: (k) => legacy.get(k) ?? null }, { appMode: 'dev_mock' });
    expect(result.migrated).toBe(true);
    expect(result.state.defaults.providerId).toBe('openrouter');
    expect(result.state.defaults.modelId).toBe('qwen/qwen3-235b');
    expect(findModel(result.state, 'openrouter', 'qwen/qwen3-235b')?.userAdded).toBe(true);
    expect(listProviders(result.state).find((p) => p.id === 'custom')?.baseUrl).toBe(
      'https://my-proxy.example.com/v1/chat/completions',
    );
    // Secret key must NEVER appear in migrated config state
    expect(JSON.stringify(result.state)).not.toContain('sk-or-secret-do-not-copy');
  });

  it('exports and imports JSON config without ever exposing API keys', () => {
    let state = createDefaultAiConfig('dev_mock');
    state = addModel(state, {
      providerId: 'openai',
      modelId: 'gpt-4.1-nano',
      label: 'GPT-4.1 Nano',
    }).state;

    // Simulate an accidental secret key injected onto the object before export
    const tainted = {
      ...state,
      apiKey: 'sk-should-never-export',
      geminiApiKey: 'AIza-secret',
    } as typeof state;

    const exported = exportAiConfig(tainted);
    expect(exported.includesApiKeys).toBe(false);
    const json = JSON.stringify(exported);
    expect(json).not.toContain('sk-should-never-export');
    expect(json).not.toContain('AIza-secret');

    const imported = importAiConfig(json);
    expect(findModel(imported, 'openai', 'gpt-4.1-nano')?.label).toBe('GPT-4.1 Nano');
  });
});
