import { describe, expect, it } from 'vitest';
import sampleLesson from '../../mocks/sampleLesson.json';
import { Block, Question, Tab } from './schemas';
import { migrateLessonV1, type LessonV1 } from './migrations';
import { parseImport } from './validation';
import { orderBetween, parseDeepLink, slugify, toDeepLink, uniqueId } from './ids';

describe('ids', () => {
  it('slugifies Vietnamese titles', () => {
    expect(slugify('Chương 3: Cân bằng axit–bazơ')).toBe('chuong-3-can-bang-axit-bazo');
    expect(slugify('Đường chuẩn độ')).toBe('duong-chuan-do');
    expect(slugify('!!!')).toBe('muc');
  });
  it('generates unique ids', () => {
    expect(uniqueId('Lý thuyết', ['ly-thuyet', 'ly-thuyet-2'])).toBe('ly-thuyet-3');
  });
  it('orders between neighbours', () => {
    expect(orderBetween()).toBe(1000);
    expect(orderBetween(1000, 2000)).toBe(1500);
    expect(orderBetween(undefined, 1000)).toBe(0);
    expect(orderBetween(1000)).toBe(2000);
  });
  it('round-trips deep links', () => {
    const target = { subjectId: 'hoa-phan-tich', chapterId: 'c03', unitId: 'u02', tabId: 'ly-thuyet', blockId: 'vung-dem' };
    const link = toDeepLink(target);
    expect(link).toBe('#/hoa-phan-tich/c03/u02/ly-thuyet#vung-dem');
    expect(parseDeepLink(link)).toEqual(target);
  });
});

describe('blocks', () => {
  it('rejects an mcq answer out of range', () => {
    const result = Block.safeParse({ id: 'q', type: 'mcq', question: '?', options: [{ text: 'a' }, { text: 'b' }], answer: 5 });
    expect(result.success).toBe(false);
  });
  it('accepts namespaced extension blocks but not unknown plain types', () => {
    expect(Block.safeParse({ id: 'a', type: 'x-reaction-3d', smiles: 'CCO' }).success).toBe(true);
    expect(Block.safeParse({ id: 'a', type: 'mystery' }).success).toBe(false);
  });
  it('rejects non-Google embed hosts', () => {
    expect(Block.safeParse({ id: 'g', type: 'google_embed', url: 'https://evil.example.com/x' }).success).toBe(false);
  });
});

describe('migration v1 → v2', () => {
  const { unit, tabs } = migrateLessonV1(sampleLesson as LessonV1, { subjectId: 'hoa-phan-tich', chapterId: 'c03-can-bang-axit-bazo' });
  it('produces a valid unit and a theory tab', () => {
    expect(unit.id).toBe('acid-base-titration-weak-acid');
    expect(unit.reference_data?.ka).toBe(1.8e-5);
    expect(unit.extensions).toEqual({ 'x-labmana-bridge': { enabled: false, schema: 'pending' } });
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.format).toBe('blocks');
    expect(tabs[0]!.blocks?.length).toBe((sampleLesson as LessonV1).payload.blocks!.length);
    expect(Tab.safeParse(tabs[0]).success).toBe(true);
  });
  it('refuses non-v1 documents', () => {
    expect(() => migrateLessonV1({ ...(sampleLesson as LessonV1), schema_version: '2.0.0' }, { subjectId: 's', chapterId: 'c' })).toThrow();
  });
});

describe('import', () => {
  it('wraps a single tab document into a bundle', () => {
    const tab = {
      id: 'bai-tap', kind: 'tab', subject_id: 'hoa-phan-tich', chapter_id: 'c03', unit_id: 'u02',
      title: 'Bài tập', type: 'exercises', format: 'markdown', markdown: '## Bài 1\nTính pH…',
    };
    const result = parseImport(JSON.stringify(tab));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.tabs[0]?.schema_version).toBe('2.0.0');
  });
  it('reports readable, path-addressed errors', () => {
    const result = parseImport(JSON.stringify({ kind: 'tab', id: 'Bad Id', format: 'blocks' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path === 'id')).toBe(true);
  });
  it('flags duplicate ids in a bundle', () => {
    const q = { id: 'q1', kind: 'question', subject_id: 'hoa-phan-tich', stem: 'x' };
    const result = parseImport(JSON.stringify({ format: 'theolab-bundle', schema_version: '2.0.0', questions: [q, q] }));
    expect(result.ok).toBe(false);
  });
  it('rejects malformed JSON', () => {
    expect(parseImport('{').ok).toBe(false);
  });
});

describe('question bank', () => {
  it('models an exam question with parts, CLO and datasets', () => {
    const question = Question.parse({
      id: 'q-2019hk1-c3', kind: 'question', subject_id: 'hoa-phan-tich', chapter_id: 'c03-can-bang-axit-bazo',
      source: { type: 'exam', ref: 'ACHE231203 HK1 2018-2019', question_no: 3 },
      concepts: ['chuan-do-da-axit', 'h3po4'], clo: ['G1', 'G2'], bloom: 'analyze', difficulty: 4, points: 2.5,
      stem: 'Mẫu X có thể chứa HCl, H₃PO₄, H₂PO₄⁻, HPO₄²⁻…', datasets: ['ka-h3po4'],
      parts: [
        { id: 'a', type: 'table_reasoning', prompt: 'Xác định thành phần X trong TN 1–6' },
        { id: 'b', type: 'numeric', prompt: 'Nồng độ mol (TN 6)', tolerance_rel: 0.01 },
      ],
    });
    expect(question.parts).toHaveLength(2);
  });
});
