/**
 * Migrations from older document shapes to the v2 content model.
 * Migrations are pure functions: they never touch storage, and their output is validated.
 */
import { SCHEMA_VERSION, Tab, Unit, type Tab as TabT, type Unit as UnitT } from './schemas';
import { slugify } from './ids';

export interface LessonV1 {
  id: string;
  schema_version: string;
  core?: { subject?: string; updated_at?: string };
  payload: { title: string; reference_data?: Record<string, unknown>; blocks?: Array<Record<string, unknown>> };
  extensions?: Record<string, unknown>;
}

export interface MigrationTarget {
  subjectId: string;
  chapterId: string;
  order?: number;
  /** Tab id for the migrated blocks. */
  tabId?: string;
  tabTitle?: string;
}

/** Obsolete v1 extensions that the v2 model replaces natively. */
const DROPPED_V1_EXTENSIONS = new Set(['ai_embedding', 'google_embed']);

function migrateExtensions(extensions: Record<string, unknown> | undefined) {
  if (!extensions) return undefined;
  const entries = Object.entries(extensions)
    .filter(([key]) => !DROPPED_V1_EXTENSIONS.has(key))
    .map(([key, value]) => [key.startsWith('x-') ? key : `x-${slugify(key)}`, value] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function scalarReferenceData(data: Record<string, unknown> | undefined) {
  if (!data) return undefined;
  const scalars = Object.entries(data).filter(
    (entry): entry is [string, string | number | boolean] => ['string', 'number', 'boolean'].includes(typeof entry[1]),
  );
  return scalars.length ? Object.fromEntries(scalars) : undefined;
}

/** v1 single-document lesson → v2 Unit + one "Lý thuyết" blocks tab. */
export function migrateLessonV1(lesson: LessonV1, target: MigrationTarget): { unit: UnitT; tabs: TabT[] } {
  if (!lesson?.schema_version?.startsWith('1.')) {
    throw new Error(`Không thể migrate: schema_version "${lesson?.schema_version}" không phải 1.x`);
  }
  const unitId = slugify(lesson.id);
  const updatedAt = lesson.core?.updated_at;
  const unit = Unit.parse({
    id: unitId,
    schema_version: SCHEMA_VERSION,
    kind: 'unit',
    subject_id: target.subjectId,
    chapter_id: target.chapterId,
    title: lesson.payload.title,
    order: target.order ?? 1000,
    status: 'draft',
    reference_data: scalarReferenceData(lesson.payload.reference_data),
    updated_at: updatedAt,
    extensions: migrateExtensions(lesson.extensions),
  });
  const tab = Tab.parse({
    id: target.tabId ?? 'ly-thuyet',
    schema_version: SCHEMA_VERSION,
    kind: 'tab',
    subject_id: target.subjectId,
    chapter_id: target.chapterId,
    unit_id: unitId,
    title: target.tabTitle ?? 'Lý thuyết',
    type: 'theory',
    order: 1000,
    format: 'blocks',
    blocks: (lesson.payload.blocks ?? []).map((block) => ({ ...block, id: slugify(String(block.id ?? '')) })),
    updated_at: updatedAt,
  });
  return { unit, tabs: [tab] };
}
