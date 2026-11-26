/** Id helpers and Firestore path conventions for the v2 content tree. */

/** Vietnamese-aware slug: "Chương 3: Cân bằng axit–bazơ" → "chuong-3-can-bang-axit-bazo". */
export function slugify(input: string, maxLength = 60): string {
  const slug = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'muc';
}

/** Returns `base`, or `base-2`, `base-3`… so that it does not collide with `taken`. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugify(base);
  if (!used.has(root)) return root;
  for (let n = 2; ; n += 1) {
    const candidate = `${root.slice(0, 75)}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Order value placed between two neighbours (fractional indexing for drag-and-drop). */
export function orderBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return (after as number) - 1000;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}

export const paths = {
  subjects: () => 'subjects',
  subject: (s: string) => `subjects/${s}`,
  chapters: (s: string) => `subjects/${s}/chapters`,
  chapter: (s: string, c: string) => `subjects/${s}/chapters/${c}`,
  units: (s: string, c: string) => `subjects/${s}/chapters/${c}/units`,
  unit: (s: string, c: string, u: string) => `subjects/${s}/chapters/${c}/units/${u}`,
  tabs: (s: string, c: string, u: string) => `subjects/${s}/chapters/${c}/units/${u}/tabs`,
  tab: (s: string, c: string, u: string, t: string) => `subjects/${s}/chapters/${c}/units/${u}/tabs/${t}`,
  questions: () => 'questions',
  question: (q: string) => `questions/${q}`,
  datasets: () => 'datasets',
  dataset: (d: string) => `datasets/${d}`,
  concepts: () => 'concepts',
  concept: (c: string) => `concepts/${c}`,
  kbChunks: () => 'kb_chunks',
  kbChunk: (id: string) => `kb_chunks/${id}`,
  /** Owner-only Storage prefix for uploaded tab files and images. */
  storageFile: (s: string, c: string, u: string, name: string) => `content/${s}/${c}/${u}/${name}`,
} as const;

export interface DeepLinkTarget {
  subjectId: string;
  chapterId?: string;
  unitId?: string;
  tabId?: string;
  blockId?: string;
}

/** `#/hoa-phan-tich/c03/u02/ly-thuyet#vung-dem` */
export function toDeepLink(t: DeepLinkTarget): string {
  const segments = [t.subjectId, t.chapterId, t.unitId, t.tabId].filter(Boolean);
  return `#/${segments.join('/')}${t.blockId ? `#${t.blockId}` : ''}`;
}

export function parseDeepLink(hash: string): DeepLinkTarget | null {
  const match = /^#\/([^#]*)(?:#(.+))?$/.exec(hash);
  if (!match) return null;
  const [subjectId, chapterId, unitId, tabId] = (match[1] ?? '').split('/').filter(Boolean);
  if (!subjectId) return null;
  return { subjectId, chapterId, unitId, tabId, blockId: match[2] };
}
