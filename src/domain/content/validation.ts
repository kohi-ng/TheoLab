/** Import validation: turns unknown JSON into typed documents with human-readable errors. */
import type { z } from 'zod';
import { ImportBundle, Tab, Unit, Question, Dataset, Concept, Chapter, Subject } from './schemas';

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; issues: ValidationIssue[] };

function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(gốc)',
    message: issue.message,
  }));
}

export function validate<S extends z.ZodType>(schema: S, input: unknown): ValidationResult<z.infer<S>> {
  const result = schema.safeParse(input);
  return result.success ? { ok: true, data: result.data } : { ok: false, issues: toIssues(result.error) };
}

const SCHEMA_BY_KIND = {
  subject: Subject,
  chapter: Chapter,
  unit: Unit,
  tab: Tab,
  question: Question,
  dataset: Dataset,
  concept: Concept,
} as const;

/**
 * Accepts either a full `theolab-bundle` or a single document with a `kind` field
 * (handy for "nạp JSON" into one tab) and normalises it to a bundle.
 */
export function parseImport(json: string): ValidationResult<ImportBundle> {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch (error) {
    return { ok: false, issues: [{ path: '(gốc)', message: `JSON không hợp lệ: ${(error as Error).message}` }] };
  }
  if (input && typeof input === 'object' && (input as { format?: unknown }).format === 'theolab-bundle') {
    const bundle = validate(ImportBundle, input);
    if (!bundle.ok) return bundle;
    const issues = checkBundleReferences(bundle.data);
    return issues.length ? { ok: false, issues } : bundle;
  }
  const kind = (input as { kind?: unknown } | null)?.kind;
  if (typeof kind !== 'string' || !(kind in SCHEMA_BY_KIND)) {
    return { ok: false, issues: [{ path: 'kind', message: 'Cần "format": "theolab-bundle" hoặc một tài liệu có "kind" hợp lệ' }] };
  }
  const single = validate(SCHEMA_BY_KIND[kind as keyof typeof SCHEMA_BY_KIND], input);
  if (!single.ok) return single;
  const key = `${kind}s` as const;
  return validate(ImportBundle, { format: 'theolab-bundle', schema_version: '2.0.0', [key]: [single.data] });
}

/** Cross-document checks inside a bundle (parents that are referenced but absent are allowed — they may already exist). */
export function checkBundleReferences(bundle: ImportBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Map<string, string>();
  const register = (collection: string, key: string, path: string) => {
    const existing = seen.get(`${collection}:${key}`);
    if (existing) issues.push({ path, message: `trùng id với ${existing}` });
    else seen.set(`${collection}:${key}`, path);
  };
  bundle.subjects.forEach((d, i) => register('subject', d.id, `subjects.${i}`));
  bundle.chapters.forEach((d, i) => register('chapter', `${d.subject_id}/${d.id}`, `chapters.${i}`));
  bundle.units.forEach((d, i) => register('unit', `${d.subject_id}/${d.chapter_id}/${d.id}`, `units.${i}`));
  bundle.tabs.forEach((d, i) => register('tab', `${d.subject_id}/${d.chapter_id}/${d.unit_id}/${d.id}`, `tabs.${i}`));
  bundle.questions.forEach((d, i) => register('question', d.id, `questions.${i}`));
  bundle.datasets.forEach((d, i) => register('dataset', d.id, `datasets.${i}`));
  bundle.concepts.forEach((d, i) => register('concept', d.id, `concepts.${i}`));
  return issues;
}
