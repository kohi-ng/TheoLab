/**
 * Zod 4 validation schemas for dynamic interactive Exercise Tabs generated
 * by Theon the Multiagent. All AI-produced JSON is untrusted and MUST pass
 * ExerciseTabPayloadSchema before mounting into WorkspaceDock.
 */
import { z } from 'zod';

export const ExerciseMcqOptionSchema = z.object({
  text: z.string().min(1).max(600),
  feedback: z.string().max(600).optional(),
});

export const ExerciseMcqItemSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    type: z.literal('mcq'),
    question: z.string().min(1).max(2000),
    options: z.array(ExerciseMcqOptionSchema).min(2).max(6),
    answer: z.number().int().nonnegative(),
    explanation: z.string().max(2000).optional(),
  })
  .refine((item) => item.answer < item.options.length, {
    message: 'answer phải là chỉ số hợp lệ trong danh sách options',
    path: ['answer'],
  });

export const ExerciseNumericItemSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  type: z.literal('numeric'),
  prompt: z.string().min(1).max(2000),
  answer: z.number().finite(),
  tolerance: z.number().nonnegative().max(1e9).default(0.05),
  unit: z.string().max(40).optional(),
  placeholder: z.string().max(120).optional(),
  explanation: z.string().max(2000).optional(),
});

export const ExerciseItemSchema = z.union([ExerciseMcqItemSchema, ExerciseNumericItemSchema]);

export const ExerciseTabPayloadSchema = z.object({
  title: z.string().min(1).max(100),
  subtitle: z.string().max(400).optional(),
  time_limit_sec: z.number().int().min(0).max(7200).optional(),
  items: z.array(ExerciseItemSchema).min(1).max(20),
});

export type ExerciseMcqItem = z.infer<typeof ExerciseMcqItemSchema>;
export type ExerciseNumericItem = z.infer<typeof ExerciseNumericItemSchema>;
export type ExerciseItem = z.infer<typeof ExerciseItemSchema>;
export type ExerciseTabPayload = z.infer<typeof ExerciseTabPayloadSchema>;

/**
 * Safely parses unknown/persisted exercise payload JSON. Returns null if invalid.
 */
export function parseExerciseTabPayload(raw: unknown): ExerciseTabPayload | null {
  const result = ExerciseTabPayloadSchema.safeParse(raw);
  return result.success ? result.data : null;
}
