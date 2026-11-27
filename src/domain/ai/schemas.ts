/**
 * Single source of truth for TheoLab AI configuration schemas (Zod 4).
 *
 * Security contract:
 * - API keys are NEVER part of `AiConfigState` or `AiConfigExport`.
 * - BYOK keys stay in browser-local `theolab:byok:<providerId>` (or owner-only Firestore Vault for Google AI Studio).
 */
import { z } from 'zod';

export const BUILTIN_PROVIDER_IDS = [
  'vertex',
  'google',
  'openai',
  'anthropic',
  'openrouter',
  'custom',
] as const;

export type BuiltinProviderId = (typeof BUILTIN_PROVIDER_IDS)[number];

export const ProviderIdSchema = z
  .string()
  .trim()
  .min(1, 'Provider ID không được rỗng.')
  .max(64, 'Provider ID tối đa 64 ký tự.')
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Provider ID chỉ gồm chữ thường, số, gạch ngang và gạch dưới.');

export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const ProviderKindSchema = z.enum([
  'openai-compatible',
  'anthropic',
  'google',
  'vertex',
]);

export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const ProviderConfigSchema = z.object({
  id: ProviderIdSchema,
  label: z.string().trim().min(1, 'Tên nhà cung cấp không được rỗng.').max(80),
  kind: ProviderKindSchema,
  baseUrl: z.string().trim().max(400).optional(),
  enabled: z.boolean().default(true),
  isCustom: z.boolean().optional(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ModelCapabilitiesSchema = z.object({
  vision: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  maxContext: z.number().int().positive().max(10_000_000).optional(),
});

export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelEntrySchema = z.object({
  id: z.string().trim().min(1).max(160),
  providerId: ProviderIdSchema,
  modelId: z.string().trim().min(1, 'Model ID không được rỗng.').max(160),
  label: z.string().trim().min(1, 'Tên hiển thị không được rỗng.').max(120),
  description: z.string().trim().max(300).optional(),
  capabilities: ModelCapabilitiesSchema.optional(),
  userAdded: z.boolean().default(false),
  hidden: z.boolean().default(false),
  createdAt: z.string().min(1),
});

export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const AiProfileSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1, 'Tên profile không được rỗng.').max(80),
  providerId: ProviderIdSchema,
  modelId: z.string().trim().min(1, 'Model ID không được rỗng.').max(160),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(64).max(128_000),
  systemPrompt: z.string().max(4000).optional(),
});

export type AiProfile = z.infer<typeof AiProfileSchema>;

export const AiDefaultsSchema = z.object({
  providerId: ProviderIdSchema,
  modelId: z.string().trim().min(1).max(160),
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().int().min(64).max(128_000).default(2048),
  systemPrompt: z.string().max(4000).default(''),
  activeProfileId: z.string().nullable().default(null),
});

export type AiDefaults = z.infer<typeof AiDefaultsSchema>;

export const AiConfigStateSchema = z.object({
  version: z.literal(1).default(1),
  providers: z.array(ProviderConfigSchema).min(1),
  /** Stores user-added models and user overrides/hide flags for seed models. */
  models: z.array(ModelEntrySchema).default([]),
  profiles: z.array(AiProfileSchema).default([]),
  defaults: AiDefaultsSchema,
  syncGoogleKeyToVault: z.boolean().default(true),
});

export type AiConfigState = z.infer<typeof AiConfigStateSchema>;

export const AiConfigExportSchema = z.object({
  format: z.literal('theolab-ai-config'),
  version: z.literal(1),
  exportedAt: z.string(),
  includesApiKeys: z.literal(false),
  config: AiConfigStateSchema,
});

export type AiConfigExport = z.infer<typeof AiConfigExportSchema>;
