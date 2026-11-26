/**
 * Configuration schema, model presets, and localStorage persistence for Theon.
 */
import { z } from 'zod';
import { APP_MODE } from '../../config/runtimeConfig.js';
import { getLocalSetting } from '../../core/dataGateway.js';

export const THEON_SETTINGS_STORAGE_KEY = 'theolab:theon-settings:v1';

export const THEON_EXPRESSIONS = [
  'friendly',
  'focused',
  'thoughtful',
  'surprised',
  'happy',
  'serious',
  'relaxed',
] as const;

export type TheonExpression = (typeof THEON_EXPRESSIONS)[number];

export const THEON_EXPRESSION_LABELS: Record<TheonExpression, string> = Object.freeze({
  friendly: 'Thân thiện',
  focused: 'Tập trung',
  thoughtful: 'Suy tư',
  surprised: 'Ngạc nhiên',
  happy: 'Vui vẻ',
  serious: 'Nghiêm túc',
  relaxed: 'Thư giãn',
});

export const THEON_HEAD_STYLES = ['planar', 'sculpture', 'translucent', 'triwire'] as const;
export type TheonHeadStyle = (typeof THEON_HEAD_STYLES)[number];

export const THEON_HEAD_STYLE_LABELS: Record<TheonHeadStyle, string> = Object.freeze({
  planar: 'Mặt phẳng + Viền cạnh',
  sculpture: 'Thuần khối Asaro',
  translucent: 'Xuyên thấu',
  triwire: 'Lưới tam giác',
});

export const THEON_PROVIDERS = [
  'vertex',
  'google',
  'openai',
  'anthropic',
  'openrouter',
  'custom',
] as const;

export type TheonProvider = (typeof THEON_PROVIDERS)[number];

export const THEON_PROVIDER_LABELS: Record<TheonProvider, string> = Object.freeze({
  vertex: 'Vertex AI (Firebase AI Logic)',
  google: 'Google AI Studio',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  custom: 'Custom (OpenAI-compatible)',
});

export interface ModelPreset {
  id: string;
  label: string;
}

export const THEON_MODEL_PRESETS: Record<TheonProvider, readonly ModelPreset[]> = Object.freeze({
  vertex: [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Khuyên dùng)' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
  google: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  ],
  openai: [
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { id: 'o4-mini', label: 'o4-mini' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet' },
    { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
  ],
  openrouter: [
    { id: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3' },
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (OR)' },
    { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (OR)' },
  ],
  custom: [{ id: 'custom', label: 'Custom model ID' }],
});

export const THEON_MATRIX_SPEEDS = ['fast', 'medium', 'slow'] as const;
export type TheonMatrixSpeed = (typeof THEON_MATRIX_SPEEDS)[number];

import { THEON_SKILL_IDS, type TheonSkillId } from './theonSkills';

export const DEFAULT_THEON_SYSTEM_PROMPT =
  'Bạn là Theon — hệ thống đa tác nhân học tập (Theon the Multiagent) trong TheoLab. Trả lời bằng tiếng Việt ngắn gọn, rõ ràng, sắc sảo. Hãy chủ động đọc skill bằng `read_skill` khi cần, dùng `search_kb` để truy cứu Kho Vector và kết tinh Sách 3D (`spawn_book`) hoặc Thẻ 3D (`spawn_tag`) gắn liên kết bấm được, dùng `draw_chart` để vẽ biểu đồ dữ liệu (cột, đường, hai trục, tròn, vành khuyên, scatter, miền) trực tiếp lên màn hình hộp, dùng `open_exercise_tab` khi người dùng muốn luyện tập/làm bài tập, và dùng `set_expression` để chọn biểu cảm khuôn mặt phù hợp.';

export const TheonSettingsSchema = z.object({
  provider: z.enum(THEON_PROVIDERS),
  model: z.string().min(1).max(160),
  temperature: z.number().min(0).max(1.2),
  systemPrompt: z.string().max(4000),
  autoContext: z.boolean(),
  headStyle: z.enum(THEON_HEAD_STYLES),
  edgeBrightness: z.number().min(0.1).max(1.0),
  bgMatrixRain: z.boolean(),
  parallaxEnabled: z.boolean(),
  readSpeed: z.number().min(0.5).max(2.5),
  matrixTextSpeed: z.enum(THEON_MATRIX_SPEEDS),
  defaultExpression: z.enum(THEON_EXPRESSIONS),
  autoExpression: z.boolean(),
  enabledSkills: z.array(z.enum(THEON_SKILL_IDS)).default([...THEON_SKILL_IDS]),
  mcpEnabled: z.boolean().default(false),
  mcpAllowedTools: z.array(z.string().min(1).max(80)).max(30).default([]),
});

export type TheonSettings = z.infer<typeof TheonSettingsSchema>;

function safeGetLocalSetting(name: string, fallback = ''): string {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    return getLocalSetting(name, fallback);
  } catch {
    return fallback;
  }
}

export function defaultModelForProvider(provider: TheonProvider): string {
  const fromGlobal = safeGetLocalSetting(`model:${provider}`, '');
  if (fromGlobal && typeof fromGlobal === 'string') return fromGlobal;
  return THEON_MODEL_PRESETS[provider][0]?.id ?? 'gemini-2.5-flash';
}

export function createDefaultTheonSettings(): TheonSettings {
  const fallbackProvider: TheonProvider = APP_MODE === 'firebase_auth' ? 'vertex' : 'google';
  const storedGlobal = safeGetLocalSetting('provider', fallbackProvider);
  const provider: TheonProvider = (THEON_PROVIDERS as readonly string[]).includes(storedGlobal)
    ? (storedGlobal as TheonProvider)
    : fallbackProvider;

  return {
    provider,
    model: defaultModelForProvider(provider),
    temperature: 0.35,
    systemPrompt: DEFAULT_THEON_SYSTEM_PROMPT,
    autoContext: true,
    headStyle: 'planar',
    edgeBrightness: 0.72,
    bgMatrixRain: true,
    parallaxEnabled: false,
    readSpeed: 1.2,
    matrixTextSpeed: 'fast',
    defaultExpression: 'friendly',
    autoExpression: true,
    enabledSkills: [...THEON_SKILL_IDS] as TheonSkillId[],
    mcpEnabled: false,
    mcpAllowedTools: [],
  };
}

export function parseTheonSettings(raw: string | null): TheonSettings {
  const defaults = createDefaultTheonSettings();
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    const merged = { ...defaults, ...parsed };
    const result = TheonSettingsSchema.safeParse(merged);
    return result.success ? result.data : defaults;
  } catch {
    return defaults;
  }
}

export function loadTheonSettings(): TheonSettings {
  if (typeof localStorage === 'undefined') return createDefaultTheonSettings();
  return parseTheonSettings(localStorage.getItem(THEON_SETTINGS_STORAGE_KEY));
}

export function saveTheonSettings(settings: TheonSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(THEON_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota or private-mode restrictions.
  }
}
