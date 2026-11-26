/**
 * Content → retrieval chunks. One block = one chunk (blocks are natural semantic units);
 * long markdown is split by headings, then by size. Each chunk carries a breadcrumb so the
 * embedding knows where the text lives, and a content hash for incremental re-embedding.
 */
import type { Block, Chapter, Concept, Dataset, Question, Subject, Tab, Unit } from '../content/schemas';
import { toDeepLink } from '../content/ids';

export type ChunkSource = 'block' | 'markdown' | 'question' | 'dataset' | 'concept';

export interface KbChunkDraft {
  id: string;
  source: ChunkSource;
  subject_id: string;
  chapter_id?: string;
  unit_id?: string;
  tab_id?: string;
  block_id?: string;
  title: string;
  breadcrumb: string;
  text: string;
  concepts: string[];
  deep_link: string;
}

export interface TabContext {
  subject: Pick<Subject, 'id' | 'title'>;
  chapter: Pick<Chapter, 'id' | 'title'>;
  unit: Pick<Unit, 'id' | 'title' | 'concepts'>;
}

const MAX_CHARS = 2400;

function blockText(block: Block): string {
  const b = block as Record<string, unknown>;
  const parts: string[] = [];
  switch (block.type) {
    case 'mcq': {
      const mcq = block as Extract<Block, { type: 'mcq' }>;
      parts.push(mcq.question);
      mcq.options.forEach((option, index) => parts.push(`${index === mcq.answer ? '(đúng) ' : ''}${option.text}${option.feedback ? ` — ${option.feedback}` : ''}`));
      break;
    }
    case 'numeric': {
      const numeric = block as Extract<Block, { type: 'numeric' }>;
      parts.push(numeric.prompt, `Đáp án: ${numeric.answer}${numeric.unit ? ` ${numeric.unit}` : ''}`);
      break;
    }
    case 'table': {
      const table = block as Extract<Block, { type: 'table' }>;
      parts.push(table.caption ?? '', table.columns.join(' | '), ...table.rows.map((row) => row.cells.join(' | ')));
      break;
    }
    default:
      for (const key of ['summary', 'content', 'formula', 'latex', 'explanation', 'caption', 'alt']) {
        if (typeof b[key] === 'string') parts.push(b[key] as string);
      }
  }
  return parts.filter(Boolean).join('\n').trim();
}

/** Splits markdown by `#`-headings, then hard-wraps oversized sections on paragraph boundaries. */
export function splitMarkdown(markdown: string, maxChars = MAX_CHARS): Array<{ heading: string; text: string }> {
  const sections: Array<{ heading: string; text: string }> = [];
  let heading = '';
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) sections.push({ heading, text });
    buffer = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#{1,4}\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = (match[1] ?? '').trim();
    } else buffer.push(line);
  }
  flush();
  return sections.flatMap((section) => {
    if (section.text.length <= maxChars) return [section];
    const pieces: Array<{ heading: string; text: string }> = [];
    let current = '';
    for (const paragraph of section.text.split(/\n{2,}/)) {
      if (current && current.length + paragraph.length + 2 > maxChars) {
        pieces.push({ heading: section.heading, text: current });
        current = '';
      }
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      while (current.length > maxChars) {
        pieces.push({ heading: section.heading, text: current.slice(0, maxChars) });
        current = current.slice(maxChars);
      }
    }
    if (current) pieces.push({ heading: section.heading, text: current });
    return pieces;
  });
}

export function chunkTab(tab: Tab, ctx: TabContext): KbChunkDraft[] {
  const crumbs = [ctx.subject.title, ctx.chapter.title, ctx.unit.title, tab.title];
  const base = {
    subject_id: ctx.subject.id,
    chapter_id: ctx.chapter.id,
    unit_id: ctx.unit.id,
    tab_id: tab.id,
  };
  const link = (blockId?: string) =>
    toDeepLink({ subjectId: ctx.subject.id, chapterId: ctx.chapter.id, unitId: ctx.unit.id, tabId: tab.id, blockId });
  const prefix = `${ctx.subject.id}__${ctx.chapter.id}__${ctx.unit.id}__${tab.id}`;

  if (tab.format === 'blocks') {
    return (tab.blocks ?? []).flatMap((block) => {
      const text = blockText(block);
      if (!text) return [];
      const title = block.title ?? block.type;
      return [{
        ...base,
        id: `${prefix}__${block.id}`,
        source: 'block' as const,
        block_id: block.id,
        title,
        breadcrumb: [...crumbs, title].join(' › '),
        text,
        concepts: [...new Set([...(ctx.unit.concepts ?? []), ...(block.concepts ?? [])])],
        deep_link: link(block.id),
      }];
    });
  }
  if (tab.format === 'markdown' && tab.markdown) {
    return splitMarkdown(tab.markdown).map((section, index) => ({
      ...base,
      id: `${prefix}__md${index}`,
      source: 'markdown' as const,
      title: section.heading || tab.title,
      breadcrumb: [...crumbs, section.heading].filter(Boolean).join(' › '),
      text: section.text,
      concepts: [...(ctx.unit.concepts ?? [])],
      deep_link: link(),
    }));
  }
  return [];
}

export function chunkQuestion(question: Question, subjectTitle: string): KbChunkDraft {
  const parts = question.parts.map((part) => `(${part.id}) ${part.prompt}`).join('\n');
  const source = question.source ? ` — ${question.source.ref}${question.source.question_no ? `, câu ${question.source.question_no}` : ''}` : '';
  return {
    id: `q__${question.id}`,
    source: 'question',
    subject_id: question.subject_id,
    chapter_id: question.chapter_id,
    title: `Câu hỏi ${question.id}${source}`,
    breadcrumb: [subjectTitle, 'Ngân hàng câu hỏi', question.id].join(' › '),
    text: [question.stem, parts, question.solution ? `Lời giải: ${question.solution}` : ''].filter(Boolean).join('\n').slice(0, MAX_CHARS * 2),
    concepts: question.concepts,
    deep_link: `#/questions/${question.id}`,
  };
}

export function chunkDataset(dataset: Dataset): KbChunkDraft {
  const header = dataset.columns.map((c) => `${c.label}${c.unit ? ` (${c.unit})` : ''}`).join(' | ');
  const rows = dataset.rows.slice(0, 60).map((row) => dataset.columns.map((c) => row[c.key] ?? '').join(' | '));
  return {
    id: `d__${dataset.id}`,
    source: 'dataset',
    subject_id: dataset.subject_id ?? 'global',
    title: dataset.title,
    breadcrumb: ['Bảng dữ liệu', dataset.title].join(' › '),
    text: [dataset.description ?? '', header, ...rows].filter(Boolean).join('\n'),
    concepts: [],
    deep_link: `#/datasets/${dataset.id}`,
  };
}

export function chunkConcept(concept: Concept): KbChunkDraft {
  return {
    id: `c__${concept.id}`,
    source: 'concept',
    subject_id: concept.subject_id ?? 'global',
    title: concept.title,
    breadcrumb: ['Khái niệm', concept.title].join(' › '),
    text: [concept.title, concept.aliases.join(', '), concept.description ?? ''].filter(Boolean).join('\n'),
    concepts: [concept.id],
    deep_link: `#/concepts/${concept.id}`,
  };
}

/** SHA-256 over everything that influences the vector, so model/dimension changes also trigger re-embedding. */
export async function contentHash(embedText: string, model: string, dims: number): Promise<string> {
  const bytes = new TextEncoder().encode(`${model}\u0000${dims}\u0000${embedText}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
