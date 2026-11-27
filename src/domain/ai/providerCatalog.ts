/**
 * Static provider catalog metadata and endpoint URL builders.
 */
import type { BuiltinProviderId, ProviderConfig, ProviderKind } from './schemas';

export type ProviderAuthType = 'firebase-auth' | 'api-key' | 'optional-api-key';

export interface ProviderMetadata {
  id: string;
  label: string;
  kind: ProviderKind;
  authType: ProviderAuthType;
  authDescription: string;
  defaultBaseUrl?: string;
  allowBaseUrlEdit: boolean;
  supportsModelList: boolean;
  supportsConnectionTest: boolean;
  keyPlaceholder?: string;
  baseUrlPlaceholder?: string;
  notes?: string;
}

export const BUILTIN_PROVIDER_CATALOG: Record<BuiltinProviderId, ProviderMetadata> = Object.freeze({
  vertex: {
    id: 'vertex',
    label: 'Vertex AI (Firebase AI Logic)',
    kind: 'vertex',
    authType: 'firebase-auth',
    authDescription: 'Xác thực qua Gmail chủ sở hữu (Firebase Auth), không cần API key.',
    allowBaseUrlEdit: false,
    supportsModelList: false,
    supportsConnectionTest: true,
    notes: 'Yêu cầu chế độ firebase_auth đã đăng nhập chủ sở hữu.',
  },
  google: {
    id: 'google',
    label: 'Google AI Studio',
    kind: 'google',
    authType: 'api-key',
    authDescription: 'Dùng chung cho Chat/Theon (Google AI Studio) và Vector Embedding (gemini-embedding-2).',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    allowBaseUrlEdit: false,
    supportsModelList: true,
    supportsConnectionTest: true,
    keyPlaceholder: 'AIza…',
    notes: 'Có thể đồng bộ lên Firestore Vault (settings/secrets) khi ở chế độ firebase_auth.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible',
    authType: 'api-key',
    authDescription: 'Khóa BYOK lưu tại localStorage trình duyệt.',
    defaultBaseUrl: 'https://api.openai.com/v1',
    allowBaseUrlEdit: false,
    supportsModelList: true,
    supportsConnectionTest: true,
    keyPlaceholder: 'sk-…',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    authType: 'api-key',
    authDescription: 'Khóa BYOK lưu tại localStorage trình duyệt (gọi trực tiếp qua CORS header).',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    allowBaseUrlEdit: false,
    supportsModelList: true,
    supportsConnectionTest: true,
    keyPlaceholder: 'sk-ant-…',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    authType: 'api-key',
    authDescription: 'Khóa BYOK lưu tại localStorage trình duyệt.',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    allowBaseUrlEdit: true,
    supportsModelList: true,
    supportsConnectionTest: true,
    keyPlaceholder: 'sk-or-…',
    baseUrlPlaceholder: 'https://openrouter.ai/api/v1',
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai-compatible',
    authType: 'optional-api-key',
    authDescription: 'Endpoint chuẩn OpenAI (Ollama, vLLM, LM Studio, Groq, proxy nội bộ…).',
    defaultBaseUrl: '',
    allowBaseUrlEdit: true,
    supportsModelList: true,
    supportsConnectionTest: true,
    keyPlaceholder: 'API Key (tùy chọn với server cục bộ)',
    baseUrlPlaceholder: 'https://api.example.com/v1 hoặc http://localhost:11434/v1',
  },
});

export function createBuiltinProviders(): ProviderConfig[] {
  return (Object.values(BUILTIN_PROVIDER_CATALOG) as ProviderMetadata[]).map((meta) => ({
    id: meta.id,
    label: meta.label,
    kind: meta.kind,
    baseUrl: meta.defaultBaseUrl || undefined,
    enabled: true,
    isCustom: meta.id === 'custom' ? true : undefined,
  }));
}

export function getProviderMetadata(provider: Pick<ProviderConfig, 'id' | 'label' | 'kind' | 'baseUrl'>): ProviderMetadata {
  const builtin = BUILTIN_PROVIDER_CATALOG[provider.id as BuiltinProviderId];
  if (builtin) return builtin;
  return {
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    authType: 'optional-api-key',
    authDescription: 'Endpoint Custom (OpenAI-compatible) do bạn thêm; khóa lưu ở localStorage trình duyệt.',
    defaultBaseUrl: provider.baseUrl ?? '',
    allowBaseUrlEdit: true,
    supportsModelList: provider.kind === 'openai-compatible',
    supportsConnectionTest: true,
    keyPlaceholder: 'API Key (tùy chọn với server cục bộ)',
    baseUrlPlaceholder: 'https://api.example.com/v1',
  };
}

export function isBuiltinProviderId(id: string): id is BuiltinProviderId {
  return Object.prototype.hasOwnProperty.call(BUILTIN_PROVIDER_CATALOG, id);
}

/**
 * Validates that a custom provider base URL is safe (`https://` or localhost `http://`).
 */
export function isAllowedProviderBaseUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolves the chat completions URL for an `openai-compatible` provider.
 * Supports both base URLs (`https://host/v1`) and legacy full URLs (`https://host/v1/chat/completions`).
 */
export function resolveOpenAiChatEndpoint(baseUrl?: string): string {
  const trimmed = (baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

/**
 * Resolves the `/models` listing URL for an `openai-compatible` provider.
 */
export function resolveOpenAiModelsEndpoint(baseUrl?: string): string {
  const trimmed = (baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed.replace(/\/chat\/completions$/i, '/models');
  }
  if (/\/models$/i.test(trimmed)) return trimmed;
  return `${trimmed}/models`;
}
