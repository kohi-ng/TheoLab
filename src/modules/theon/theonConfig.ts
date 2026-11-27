/**
 * Configuration schema, model presets, and localStorage persistence for Theon.
 */
import { z } from 'zod';
import { APP_MODE } from '../../config/runtimeConfig.js';
import { BUILTIN_PROVIDER_CATALOG } from '../../domain/ai/providerCatalog';
import {
  BUILTIN_PROVIDER_IDS,
  ProviderIdSchema,
  type ProviderId,
} from '../../domain/ai/schemas';
import {
  SEED_MODELS,
  createDefaultAiConfig,
  getDefaultModelForProvider,
} from '../../domain/ai/modelRegistry';
import { aiConfigStore } from '../../core/aiConfigStore.svelte';

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

export const THEON_PROVIDERS = BUILTIN_PROVIDER_IDS;

export type TheonProvider = ProviderId;

export const THEON_PROVIDER_LABELS: Record<string, string> = Object.freeze(
  Object.fromEntries(
    Object.values(BUILTIN_PROVIDER_CATALOG).map((meta) => [meta.id, meta.label]),
  ),
);

export interface ModelPreset {
  id: string;
  label: string;
}

/**
 * Derived from the centralized AI seed registry (kept for backwards compatibility with tests/callers).
 * Live UI reads directly from `aiConfigStore.listModels()`.
 */
export const THEON_MODEL_PRESETS: Record<string, readonly ModelPreset[]> = Object.freeze(
  Object.fromEntries(
    BUILTIN_PROVIDER_IDS.map((pid) => [
      pid,
      SEED_MODELS.filter((m) => m.providerId === pid && !m.hidden).map((m) => ({
        id: m.modelId,
        label: m.label,
      })),
    ]),
  ),
);

export const THEON_MATRIX_SPEEDS = ['fast', 'medium', 'slow'] as const;
export type TheonMatrixSpeed = (typeof THEON_MATRIX_SPEEDS)[number];

import { THEON_SKILL_IDS, type TheonSkillId } from './theonSkills';

export const DEFAULT_THEON_SYSTEM_PROMPT =
  'Bạn là Theon — hệ thống đa tác nhân học tập (Theon the Multiagent) trong TheoLab. Trả lời bằng tiếng Việt ngắn gọn, rõ ràng, sắc sảo. Hãy chủ động đọc skill bằng `read_skill` khi cần, dùng `search_kb` để truy cứu Kho Vector và kết tinh Sách 3D (`spawn_book`) hoặc Thẻ 3D (`spawn_tag`) gắn liên kết bấm được, dùng `draw_chart` để vẽ biểu đồ dữ liệu (cột, đường, hai trục, tròn, vành khuyên, scatter, miền) trực tiếp lên màn hình hộp, dùng `open_exercise_tab` khi người dùng muốn luyện tập/làm bài tập, và dùng `set_expression` để chọn biểu cảm khuôn mặt phù hợp.';

const KnownOrCustomProviderSchema = ProviderIdSchema.refine(
  (id) => (BUILTIN_PROVIDER_IDS as readonly string[]).includes(id) || id.startsWith('custom-'),
  { message: 'Nhà cung cấp không hợp lệ.' },
);

export const TheonSettingsSchema = z.object({
  provider: KnownOrCustomProviderSchema,
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

export function defaultModelForProvider(provider: TheonProvider): string {
  const fromStore = aiConfigStore.getDefaultModelForProvider(provider)?.modelId;
  if (fromStore) return fromStore;
  const fallback = getDefaultModelForProvider(createDefaultAiConfig(APP_MODE), provider)?.modelId;
  return fallback ?? 'gemini-2.5-flash';
}

export function createDefaultTheonSettings(): TheonSettings {
  const defaults = aiConfigStore.defaults;
  const provider = defaults.providerId;

  return {
    provider,
    model: defaults.modelId || defaultModelForProvider(provider),
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
