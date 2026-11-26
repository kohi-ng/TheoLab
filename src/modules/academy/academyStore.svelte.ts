/**
 * Reactive Svelte 5 rune store for the v2 Academy tree
 * (Subject ▸ Chapter ▸ Unit ▸ Tab) with deep-link and contextBus sync.
 */
import { contentRepo, type ImportSummary } from '../../core/contentRepository';
import { updateContext } from '../../core/contextBus.js';
import { orderBetween, parseDeepLink, toDeepLink, uniqueId } from '../../domain/content/ids';
import { parseImport, type ValidationIssue } from '../../domain/content/validation';
import type { Chapter, Subject, Tab, TabType, Unit } from '../../domain/content/schemas';

export const TAB_PRESETS: Array<{ type: TabType; label: string; format: Tab['format']; defaultTitle: string }> = [
  { type: 'theory', label: 'Lý thuyết (Blocks)', format: 'blocks', defaultTitle: 'Lý thuyết' },
  { type: 'examples', label: 'Ví dụ giải (Markdown)', format: 'markdown', defaultTitle: 'Ví dụ giải' },
  { type: 'exercises', label: 'Bài tập (Blocks)', format: 'blocks', defaultTitle: 'Bài tập' },
  { type: 'notes', label: 'Ghi chú (Markdown)', format: 'markdown', defaultTitle: 'Ghi chú' },
  { type: 'simulation', label: 'Mô phỏng (Blocks)', format: 'blocks', defaultTitle: 'Mô phỏng' },
  { type: 'file', label: 'Tài liệu đính kèm (File)', format: 'file', defaultTitle: 'Tài liệu' },
  { type: 'custom', label: 'Tùy biến (Markdown)', format: 'markdown', defaultTitle: 'Mục mới' },
];

class AcademyStore {
  subjects = $state<Subject[]>([]);
  chaptersBySubject = $state<Record<string, Chapter[]>>({});
  unitsByChapter = $state<Record<string, Unit[]>>({});
  tabsByUnit = $state<Record<string, Tab[]>>({});

  activeSubjectId = $state<string | null>(null);
  activeChapterId = $state<string | null>(null);
  activeUnitId = $state<string | null>(null);
  activeTabId = $state<string | null>(null);
  activeBlockId = $state<string | null>(null);

  loading = $state(false);
  error = $state<string | null>(null);
  importModalOpen = $state(false);

  private listeners = new Set<(event: { type: 'toast' | 'unit-selected'; message?: string; title?: string }) => void>();

  onEvent(cb: (event: { type: 'toast' | 'unit-selected'; message?: string; title?: string }) => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private emit(event: { type: 'toast' | 'unit-selected'; message?: string; title?: string }) {
    this.listeners.forEach((cb) => cb(event));
  }

  get activeSubject(): Subject | null {
    return this.subjects.find((s) => s.id === this.activeSubjectId) ?? null;
  }

  get activeChapter(): Chapter | null {
    if (!this.activeSubjectId) return null;
    return (this.chaptersBySubject[this.activeSubjectId] ?? []).find((c) => c.id === this.activeChapterId) ?? null;
  }

  get activeUnit(): Unit | null {
    if (!this.activeSubjectId || !this.activeChapterId) return null;
    const key = `${this.activeSubjectId}/${this.activeChapterId}`;
    return (this.unitsByChapter[key] ?? []).find((u) => u.id === this.activeUnitId) ?? null;
  }

  get activeTabs(): Tab[] {
    if (!this.activeSubjectId || !this.activeChapterId || !this.activeUnitId) return [];
    const key = `${this.activeSubjectId}/${this.activeChapterId}/${this.activeUnitId}`;
    return this.tabsByUnit[key] ?? [];
  }

  get activeTab(): Tab | null {
    return this.activeTabs.find((t) => t.id === this.activeTabId) ?? this.activeTabs[0] ?? null;
  }

  chapterKey(subjectId: string, chapterId: string) {
    return `${subjectId}/${chapterId}`;
  }

  unitKey(subjectId: string, chapterId: string, unitId: string) {
    return `${subjectId}/${chapterId}/${unitId}`;
  }

  private syncHashAndContext() {
    if (this.activeSubjectId) {
      const link = toDeepLink({
        subjectId: this.activeSubjectId,
        chapterId: this.activeChapterId ?? undefined,
        unitId: this.activeUnitId ?? undefined,
        tabId: this.activeTabId ?? undefined,
        blockId: this.activeBlockId ?? undefined,
      });
      if (window.location.hash !== link) {
        window.history.replaceState(null, '', link);
      }
    }
    const unit = this.activeUnit;
    const tab = this.activeTab;
    updateContext({
      lessonId: unit ? `${unit.subject_id}/${unit.chapter_id}/${unit.id}` : null,
      lessonTitle: unit ? (tab ? `${unit.title} · ${tab.title}` : unit.title) : null,
      selectedBlockId: this.activeBlockId,
    });
    if (unit) {
      this.emit({ type: 'unit-selected', title: unit.title });
    }
  }

  async init() {
    this.loading = true;
    this.error = null;
    try {
      await this.refreshTree();
      const target = parseDeepLink(window.location.hash);
      if (target && this.subjects.some((s) => s.id === target.subjectId)) {
        await this.selectPath(target.subjectId, target.chapterId, target.unitId, target.tabId, target.blockId);
      } else {
        await this.selectFirstAvailable();
      }
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async refreshTree() {
    const subjects = await contentRepo.listSubjects();
    const chaptersBySubject: Record<string, Chapter[]> = {};
    const unitsByChapter: Record<string, Unit[]> = {};
    for (const s of subjects) {
      const chapters = await contentRepo.listChapters(s.id);
      chaptersBySubject[s.id] = chapters;
      for (const c of chapters) {
        const units = await contentRepo.listUnits(s.id, c.id);
        unitsByChapter[this.chapterKey(s.id, c.id)] = units;
      }
    }
    this.subjects = subjects;
    this.chaptersBySubject = chaptersBySubject;
    this.unitsByChapter = unitsByChapter;
  }

  async selectFirstAvailable() {
    const s = this.subjects[0];
    if (!s) return;
    const c = (this.chaptersBySubject[s.id] ?? [])[0];
    const u = c ? (this.unitsByChapter[this.chapterKey(s.id, c.id)] ?? [])[0] : undefined;
    await this.selectPath(s.id, c?.id, u?.id);
  }

  async selectPath(subjectId: string, chapterId?: string, unitId?: string, tabId?: string, blockId?: string) {
    this.activeSubjectId = subjectId;
    const chapters = this.chaptersBySubject[subjectId] ?? [];
    const resolvedChapter = chapterId && chapters.some((c) => c.id === chapterId) ? chapterId : chapters[0]?.id ?? null;
    this.activeChapterId = resolvedChapter;

    if (!resolvedChapter) {
      this.activeUnitId = null;
      this.activeTabId = null;
      this.activeBlockId = null;
      this.syncHashAndContext();
      return;
    }

    const units = this.unitsByChapter[this.chapterKey(subjectId, resolvedChapter)] ?? [];
    const resolvedUnit = unitId && units.some((u) => u.id === unitId) ? unitId : units[0]?.id ?? null;
    this.activeUnitId = resolvedUnit;

    if (!resolvedUnit) {
      this.activeTabId = null;
      this.activeBlockId = null;
      this.syncHashAndContext();
      return;
    }

    const tabs = await contentRepo.listTabs(subjectId, resolvedChapter, resolvedUnit);
    this.tabsByUnit = { ...this.tabsByUnit, [this.unitKey(subjectId, resolvedChapter, resolvedUnit)]: tabs };
    this.activeTabId = tabId && tabs.some((t) => t.id === tabId) ? tabId : tabs[0]?.id ?? null;
    this.activeBlockId = blockId ?? null;
    this.syncHashAndContext();
  }

  selectTab(tabId: string) {
    this.activeTabId = tabId;
    this.activeBlockId = null;
    this.syncHashAndContext();
  }

  /* --------------------------------------------------------------- Creation */

  async createSubject(title: string, code?: string) {
    const clean = title.trim();
    if (!clean) return;
    const id = uniqueId(clean, this.subjects.map((s) => s.id));
    const lastOrder = this.subjects.at(-1)?.order;
    const created = await contentRepo.saveSubject({
      id,
      kind: 'subject',
      title: clean,
      code: code?.trim() || undefined,
      order: orderBetween(lastOrder),
    });
    this.subjects = [...this.subjects, created];
    this.chaptersBySubject = { ...this.chaptersBySubject, [created.id]: [] };
    this.emit({ type: 'toast', message: `Đã tạo môn "${created.title}".` });
    return created;
  }

  async createChapter(subjectId: string, title: string) {
    const clean = title.trim();
    if (!clean) return;
    const existing = this.chaptersBySubject[subjectId] ?? [];
    const id = uniqueId(clean, existing.map((c) => c.id));
    const created = await contentRepo.saveChapter({
      id,
      kind: 'chapter',
      subject_id: subjectId,
      title: clean,
      order: orderBetween(existing.at(-1)?.order),
    });
    this.chaptersBySubject = { ...this.chaptersBySubject, [subjectId]: [...existing, created] };
    this.unitsByChapter = { ...this.unitsByChapter, [this.chapterKey(subjectId, created.id)]: [] };
    this.emit({ type: 'toast', message: `Đã tạo chương "${created.title}".` });
    return created;
  }

  async createUnit(subjectId: string, chapterId: string, title: string) {
    const clean = title.trim();
    if (!clean) return;
    const key = this.chapterKey(subjectId, chapterId);
    const existing = this.unitsByChapter[key] ?? [];
    const id = uniqueId(clean, existing.map((u) => u.id));
    const created = await contentRepo.saveUnit({
      id,
      kind: 'unit',
      subject_id: subjectId,
      chapter_id: chapterId,
      title: clean,
      order: orderBetween(existing.at(-1)?.order),
      status: 'draft',
    });
    // Create a default Markdown tab so the new unit is immediately writable.
    const defaultTab = await contentRepo.saveTab({
      id: 'ly-thuyet',
      kind: 'tab',
      subject_id: subjectId,
      chapter_id: chapterId,
      unit_id: created.id,
      title: 'Lý thuyết',
      type: 'theory',
      order: 1000,
      format: 'markdown',
      markdown: `## ${created.title}\n\nBắt đầu ghi chú hoặc bấm **Chỉnh sửa** để soạn nội dung.`,
    });
    this.unitsByChapter = { ...this.unitsByChapter, [key]: [...existing, created] };
    this.tabsByUnit = { ...this.tabsByUnit, [this.unitKey(subjectId, chapterId, created.id)]: [defaultTab] };
    await this.selectPath(subjectId, chapterId, created.id, defaultTab.id);
    this.emit({ type: 'toast', message: `Đã tạo bài "${created.title}".` });
    return created;
  }

  async createTab(params: { title: string; type: TabType; format: Tab['format']; driveUrl?: string }) {
    if (!this.activeSubjectId || !this.activeChapterId || !this.activeUnitId) return;
    const clean = params.title.trim() || 'Tab mới';
    const existing = this.activeTabs;
    const id = uniqueId(clean, existing.map((t) => t.id));
    const order = orderBetween(existing.at(-1)?.order);

    let tabInput: Parameters<typeof contentRepo.saveTab>[0];
    if (params.format === 'blocks') {
      tabInput = {
        id, kind: 'tab',
        subject_id: this.activeSubjectId, chapter_id: this.activeChapterId, unit_id: this.activeUnitId,
        title: clean, type: params.type, order, format: 'blocks',
        blocks: [{ id: 'noi-dung-1', type: 'theory', title: clean, content: 'Nhập nội dung cho khối này…' }],
      };
    } else if (params.format === 'file') {
      const url = params.driveUrl?.trim();
      tabInput = {
        id, kind: 'tab',
        subject_id: this.activeSubjectId, chapter_id: this.activeChapterId, unit_id: this.activeUnitId,
        title: clean, type: params.type, order, format: 'file',
        file: { name: clean, drive_url: url || undefined },
      };
    } else {
      tabInput = {
        id, kind: 'tab',
        subject_id: this.activeSubjectId, chapter_id: this.activeChapterId, unit_id: this.activeUnitId,
        title: clean, type: params.type, order, format: 'markdown',
        markdown: `## ${clean}\n\n`,
      };
    }

    const created = await contentRepo.saveTab(tabInput);
    const key = this.unitKey(this.activeSubjectId, this.activeChapterId, this.activeUnitId);
    this.tabsByUnit = { ...this.tabsByUnit, [key]: [...existing, created] };
    this.selectTab(created.id);
    this.emit({ type: 'toast', message: `Đã thêm tab "${created.title}".` });
    return created;
  }

  async saveActiveTab(patch: Partial<Tab>) {
    const current = this.activeTab;
    if (!current) return;
    const updated = await contentRepo.saveTab({ ...current, ...patch });
    const key = this.unitKey(updated.subject_id, updated.chapter_id, updated.unit_id);
    this.tabsByUnit = {
      ...this.tabsByUnit,
      [key]: this.activeTabs.map((t) => (t.id === updated.id ? updated : t)),
    };
    this.emit({ type: 'toast', message: `Đã lưu tab "${updated.title}".` });
    return updated;
  }

  async updateActiveTabDriveLink(name: string, driveUrl: string) {
    const current = this.activeTab;
    if (!current || current.format !== 'file') return;
    return this.saveActiveTab({
      file: {
        ...current.file,
        name: name.trim() || current.title,
        drive_url: driveUrl.trim() || undefined,
      },
    });
  }

  async deleteActiveTab() {
    const current = this.activeTab;
    if (!current) return;
    await contentRepo.deleteTab(current.subject_id, current.chapter_id, current.unit_id, current.id);
    const key = this.unitKey(current.subject_id, current.chapter_id, current.unit_id);
    const remaining = this.activeTabs.filter((t) => t.id !== current.id);
    this.tabsByUnit = { ...this.tabsByUnit, [key]: remaining };
    this.activeTabId = remaining[0]?.id ?? null;
    this.syncHashAndContext();
    this.emit({ type: 'toast', message: `Đã xóa tab "${current.title}".` });
  }

  /* --------------------------------------------------------- Import / Export */

  async importJsonText(jsonText: string): Promise<{ ok: true; summary: ImportSummary } | { ok: false; issues: ValidationIssue[] }> {
    const parsed = parseImport(jsonText);
    if (!parsed.ok) return parsed;
    const summary = await contentRepo.importBundle(parsed.data);
    await this.refreshTree();
    if (this.activeSubjectId && this.activeChapterId && this.activeUnitId) {
      await this.selectPath(this.activeSubjectId, this.activeChapterId, this.activeUnitId, this.activeTabId ?? undefined);
    } else {
      await this.selectFirstAvailable();
    }
    this.emit({ type: 'toast', message: 'Đã nạp JSON thành công.' });
    return { ok: true, summary };
  }

  async exportActiveUnitJson(): Promise<string> {
    if (!this.activeSubjectId || !this.activeChapterId || !this.activeUnitId) {
      throw new Error('Chưa chọn bài học để xuất.');
    }
    const bundle = await contentRepo.exportUnitBundle(this.activeSubjectId, this.activeChapterId, this.activeUnitId);
    return JSON.stringify(bundle, null, 2);
  }
}

export const academyStore = new AcademyStore();
