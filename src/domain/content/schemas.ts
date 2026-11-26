/**
 * TheoLab content model v2 — Subject ▸ Chapter ▸ Unit ▸ Tab ▸ Block.
 *
 * Firestore constraints that shape this schema:
 * - No arrays of arrays (tables use `{ cells: [] }` rows).
 * - Documents ≤ 1 MiB, so tab content lives in its own document.
 * All documents are untrusted input: validate before saving and before rendering.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = '2.0.0';

/** Stable slug id: lowercase ASCII, digits, hyphen. Used in Firestore paths and deep links. */
export const Id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/, 'id chỉ gồm a-z, 0-9, dấu gạch ngang (tối đa 80 ký tự)');

const IsoDate = z.iso.datetime({ offset: true });
const Order = z.number().finite();
const Markdown = z.string().max(200_000);

const Envelope = {
  id: Id,
  schema_version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  created_at: IsoDate.optional(),
  updated_at: IsoDate.optional(),
  /** Namespaced extension data, e.g. `{ "x-anki": {...} }`. */
  extensions: z.record(z.string().regex(/^x-[a-z0-9-]+$/), z.unknown()).optional(),
};

/* ------------------------------------------------------------------ Blocks */

const BlockBase = {
  id: Id,
  title: z.string().max(300).optional(),
  concepts: z.array(Id).optional(),
};

export const TheoryBlock = z.object({
  ...BlockBase,
  type: z.literal('theory'),
  content: Markdown,
  formula: z.string().optional(),
});
export const CalloutBlock = z.object({
  ...BlockBase,
  type: z.literal('callout'),
  tone: z.enum(['note', 'tip', 'important', 'warning']).optional(),
  content: Markdown,
});
export const CollapsibleBlock = z.object({
  ...BlockBase,
  type: z.literal('collapsible'),
  summary: z.string().optional(),
  content: Markdown,
});
export const MarkdownBlock = z.object({ ...BlockBase, type: z.literal('markdown'), content: Markdown });
export const FormulaBlock = z.object({
  ...BlockBase,
  type: z.literal('formula'),
  latex: z.string().min(1),
  explanation: z.string().optional(),
});
export const McqBlock = z
  .object({
    ...BlockBase,
    type: z.literal('mcq'),
    question: z.string().min(1),
    options: z.array(z.object({ text: z.string().min(1), feedback: z.string().optional() })).min(2),
    answer: z.int().nonnegative(),
  })
  .refine((block) => block.answer < block.options.length, {
    message: 'answer phải là chỉ số hợp lệ trong options',
    path: ['answer'],
  });
export const NumericBlock = z.object({
  ...BlockBase,
  type: z.literal('numeric'),
  prompt: z.string().min(1),
  answer: z.number().finite(),
  /** Absolute tolerance. */
  tolerance: z.number().nonnegative().optional(),
  /** Relative tolerance (0.01 = 1 %). Either may be used; the check passes if any matches. */
  tolerance_rel: z.number().nonnegative().optional(),
  unit: z.string().optional(),
  placeholder: z.string().optional(),
});
export const WidgetEmbedBlock = z.object({
  ...BlockBase,
  type: z.literal('widget_embed'),
  file: z.string().regex(/^[\w.-]+\.html$/i),
  height: z.number().int().min(240).max(1200).optional(),
  initial_state: z.record(z.string(), z.unknown()).optional(),
});
export const WidgetNativeBlock = z.object({
  ...BlockBase,
  type: z.literal('widget_native'),
  widget_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  props: z.record(z.string(), z.unknown()).optional(),
});
export const QuestionRefBlock = z.object({ ...BlockBase, type: z.literal('question_ref'), qid: Id });
export const ImageBlock = z.object({
  ...BlockBase,
  type: z.literal('image'),
  /** Firebase Storage path (owner-only) — never a public URL for private material. */
  storage_path: z.string().min(1),
  alt: z.string().min(1),
  caption: z.string().optional(),
});
export const TableBlock = z.object({
  ...BlockBase,
  type: z.literal('table'),
  columns: z.array(z.string()).min(1),
  rows: z.array(z.object({ cells: z.array(z.string()) })),
  caption: z.string().optional(),
});
export const GoogleEmbedBlock = z.object({
  ...BlockBase,
  type: z.literal('google_embed'),
  url: z.url({ protocol: /^https$/, hostname: /^(drive|docs)\.google\.com$/ }),
});
export const DatasetRefBlock = z.object({
  ...BlockBase,
  type: z.literal('dataset_ref'),
  dataset_id: Id,
});

export const KnownBlock = z.union([
  TheoryBlock,
  CalloutBlock,
  CollapsibleBlock,
  MarkdownBlock,
  FormulaBlock,
  McqBlock,
  NumericBlock,
  WidgetEmbedBlock,
  WidgetNativeBlock,
  QuestionRefBlock,
  ImageBlock,
  TableBlock,
  DatasetRefBlock,
  GoogleEmbedBlock,
]);

export const KNOWN_BLOCK_TYPES = [
  'theory', 'callout', 'collapsible', 'markdown', 'formula', 'mcq', 'numeric',
  'widget_embed', 'widget_native', 'question_ref', 'image', 'table', 'dataset_ref', 'google_embed',
] as const;

/** Future/extension block types are preserved but must be namespaced (`x-...`). */
export const ExtensionBlock = z.looseObject({ ...BlockBase, type: z.string().regex(/^x-[a-z0-9-]+$/) });

export const Block = z.union([KnownBlock, ExtensionBlock]);

/* --------------------------------------------------------------- Hierarchy */

export const LearningOutcome = z.object({ id: z.string().min(1).max(20), text: z.string().min(1) });

export const Subject = z.object({
  ...Envelope,
  kind: z.literal('subject'),
  title: z.string().min(1).max(200),
  code: z.string().max(40).optional(),
  description: Markdown.optional(),
  order: Order.default(0),
  clo: z.array(LearningOutcome).default([]),
  tags: z.array(z.string()).default([]),
});

export const Chapter = z.object({
  ...Envelope,
  kind: z.literal('chapter'),
  subject_id: Id,
  title: z.string().min(1).max(200),
  summary: Markdown.optional(),
  order: Order.default(0),
  clo_ids: z.array(z.string()).default([]),
});

export const UnitStatus = z.enum(['draft', 'published', 'archived']);

export const Unit = z.object({
  ...Envelope,
  kind: z.literal('unit'),
  subject_id: Id,
  chapter_id: Id,
  title: z.string().min(1).max(200),
  summary: Markdown.optional(),
  order: Order.default(0),
  status: UnitStatus.default('draft'),
  concepts: z.array(Id).default([]),
  /** Unit ids (same subject) that should be learned first. */
  prerequisites: z.array(Id).default([]),
  /** Small constants shared by blocks/widgets of this unit (Ka, nồng độ…). */
  reference_data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const TAB_TYPES = ['theory', 'examples', 'exercises', 'simulation', 'exam', 'notes', 'file', 'custom'] as const;
export const TabType = z.enum(TAB_TYPES);

export const GoogleDriveUrl = z.url({ protocol: /^https$/, hostname: /^(drive|docs)\.google\.com$/ });

export const TabFile = z.object({
  drive_url: GoogleDriveUrl.optional(),
  name: z.string().min(1),
  mime: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export const Tab = z
  .object({
    ...Envelope,
    kind: z.literal('tab'),
    subject_id: Id,
    chapter_id: Id,
    unit_id: Id,
    title: z.string().min(1).max(120),
    type: TabType.default('custom'),
    order: Order.default(0),
    format: z.enum(['blocks', 'markdown', 'file']),
    blocks: z.array(Block).optional(),
    markdown: Markdown.optional(),
    file: TabFile.optional(),
  })
  .superRefine((tab, ctx) => {
    if (tab.format === 'blocks' && !tab.blocks) ctx.addIssue({ code: 'custom', path: ['blocks'], message: 'format "blocks" cần mảng blocks' });
    if (tab.format === 'markdown' && tab.markdown === undefined) ctx.addIssue({ code: 'custom', path: ['markdown'], message: 'format "markdown" cần nội dung markdown' });
    if (tab.format === 'file' && !tab.file) ctx.addIssue({ code: 'custom', path: ['file'], message: 'format "file" cần thông tin file' });
    const ids = new Set<string>();
    tab.blocks?.forEach((block, index) => {
      if (ids.has(block.id)) ctx.addIssue({ code: 'custom', path: ['blocks', index, 'id'], message: `block id "${block.id}" bị trùng` });
      ids.add(block.id);
    });
  });

/* ---------------------------------------------- Question bank & references */

export const QuestionPart = z.object({
  id: z.string().min(1).max(10),
  type: z.enum(['numeric', 'mcq', 'open', 'table_reasoning']),
  prompt: Markdown,
  answer: z.union([z.number(), z.int(), z.string(), z.array(z.number())]).optional(),
  tolerance: z.number().nonnegative().optional(),
  tolerance_rel: z.number().nonnegative().optional(),
  unit: z.string().optional(),
  options: z.array(z.object({ text: z.string(), feedback: z.string().optional() })).optional(),
  points: z.number().nonnegative().optional(),
});

export const Question = z.object({
  ...Envelope,
  kind: z.literal('question'),
  subject_id: Id,
  chapter_id: Id.optional(),
  source: z
    .object({
      type: z.enum(['exam', 'textbook', 'self', 'ai']),
      ref: z.string().min(1),
      question_no: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
  concepts: z.array(Id).default([]),
  clo: z.array(z.string()).default([]),
  bloom: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']).optional(),
  difficulty: z.int().min(1).max(5).default(3),
  points: z.number().nonnegative().optional(),
  stem: Markdown,
  datasets: z.array(Id).default([]),
  parts: z.array(QuestionPart).default([]),
  solution: Markdown.optional(),
  assets: z.array(z.object({ storage_path: z.string(), alt: z.string() })).default([]),
});

export const Dataset = z.object({
  ...Envelope,
  kind: z.literal('dataset'),
  subject_id: Id.optional(),
  title: z.string().min(1),
  description: Markdown.optional(),
  columns: z.array(z.object({ key: z.string().min(1), label: z.string().min(1), unit: z.string().optional() })).min(1),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  source: z.string().optional(),
});

export const Concept = z.object({
  ...Envelope,
  kind: z.literal('concept'),
  subject_id: Id.optional(),
  title: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  description: Markdown.optional(),
  /** Concept ids that this concept is a prerequisite of. */
  prerequisite_of: z.array(Id).default([]),
  related: z.array(Id).default([]),
});

/* ------------------------------------------------------------ Import bundle */

/** One JSON file can import any mix of documents (a tab, a unit, a whole chapter…). */
export const ImportBundle = z.object({
  format: z.literal('theolab-bundle'),
  schema_version: z.literal(SCHEMA_VERSION),
  subjects: z.array(Subject).default([]),
  chapters: z.array(Chapter).default([]),
  units: z.array(Unit).default([]),
  tabs: z.array(Tab).default([]),
  questions: z.array(Question).default([]),
  datasets: z.array(Dataset).default([]),
  concepts: z.array(Concept).default([]),
});

export type Block = z.infer<typeof Block>;
export type KnownBlock = z.infer<typeof KnownBlock>;
export type Subject = z.infer<typeof Subject>;
export type Chapter = z.infer<typeof Chapter>;
export type Unit = z.infer<typeof Unit>;
export type Tab = z.infer<typeof Tab>;
export type TabType = z.infer<typeof TabType>;
export type Question = z.infer<typeof Question>;
export type Dataset = z.infer<typeof Dataset>;
export type Concept = z.infer<typeof Concept>;
export type ImportBundle = z.infer<typeof ImportBundle>;
