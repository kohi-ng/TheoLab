import { describe, expect, it } from 'vitest';
import { createContentRepository, createLocalBackend, createMemoryStore } from './contentRepository';
import { parseImport } from '../domain/content/validation';

describe('contentRepository (local mock backend)', () => {
  it('seeds Analytical Chemistry with chapter, migrated unit, and two tabs', async () => {
    const repo = createContentRepository(createLocalBackend(createMemoryStore(), true));
    const subjects = await repo.listSubjects();
    expect(subjects.map((s) => s.id)).toEqual(['hoa-phan-tich']);
    const chapters = await repo.listChapters('hoa-phan-tich');
    expect(chapters).toHaveLength(1);
    const units = await repo.listUnits('hoa-phan-tich', chapters[0]!.id);
    expect(units).toHaveLength(1);
    const tabs = await repo.listTabs('hoa-phan-tich', chapters[0]!.id, units[0]!.id);
    expect(tabs.map((t) => t.id)).toEqual(['ly-thuyet', 'ghi-chu-nhanh']);
  });

  it('creates, lists in order, and deletes hierarchy nodes', async () => {
    const repo = createContentRepository(createLocalBackend(createMemoryStore(), false));
    await repo.saveSubject({ id: 'hoa-huu-co', kind: 'subject', title: 'Hóa hữu cơ', order: 2000 });
    await repo.saveSubject({ id: 'hoa-phan-tich', kind: 'subject', title: 'Hóa phân tích', order: 1000 });
    expect((await repo.listSubjects()).map((s) => s.id)).toEqual(['hoa-phan-tich', 'hoa-huu-co']);

    await repo.saveChapter({ id: 'c01', kind: 'chapter', subject_id: 'hoa-phan-tich', title: 'Chương 1', order: 1000 });
    await repo.saveUnit({ id: 'u01', kind: 'unit', subject_id: 'hoa-phan-tich', chapter_id: 'c01', title: 'Bài 1', order: 1000 });
    await repo.saveTab({
      id: 'vi-du', kind: 'tab', subject_id: 'hoa-phan-tich', chapter_id: 'c01', unit_id: 'u01',
      title: 'Ví dụ', type: 'examples', order: 1000, format: 'markdown', markdown: 'Ví dụ 1',
    });
    expect(await repo.listTabs('hoa-phan-tich', 'c01', 'u01')).toHaveLength(1);

    await repo.deleteChapter('hoa-phan-tich', 'c01');
    expect(await repo.listUnits('hoa-phan-tich', 'c01')).toHaveLength(0);
    expect(await repo.listTabs('hoa-phan-tich', 'c01', 'u01')).toHaveLength(0);
  });

  it('imports a validated JSON bundle and exports a unit bundle', async () => {
    const repo = createContentRepository(createLocalBackend(createMemoryStore(), true));
    const tabJson = JSON.stringify({
      id: 'bai-tap-bo-sung',
      kind: 'tab',
      subject_id: 'hoa-phan-tich',
      chapter_id: 'c03-can-bang-axit-bazo',
      unit_id: 'acid-base-titration-weak-acid',
      title: 'Bài tập bổ sung',
      type: 'exercises',
      order: 3000,
      format: 'markdown',
      markdown: '## Bài tập\nTính pH của dung dịch đệm.',
    });
    const parsed = parseImport(tabJson);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const summary = await repo.importBundle(parsed.data);
    expect(summary.tabs).toBe(1);

    const exported = await repo.exportUnitBundle('hoa-phan-tich', 'c03-can-bang-axit-bazo', 'acid-base-titration-weak-acid');
    expect(exported.units).toHaveLength(1);
    expect(exported.tabs.map((t) => t.id)).toContain('bai-tap-bo-sung');
  });
});
