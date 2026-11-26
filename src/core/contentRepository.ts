/**
 * Persistence gateway for the v2 content model (Subject ▸ Chapter ▸ Unit ▸ Tab,
 * plus Question / Dataset / Concept).
 *
 * - `dev_mock`: stored in browser `localStorage` and seeded once with Analytical
 *   Chemistry + the migrated v1 sample lesson so the UI works offline.
 * - `firebase_auth`: stored in owner-only Firestore & Firebase Storage.
 * Every write is validated through Zod before touching persistence.
 */
import sampleLesson from '../mocks/sampleLesson.json';
import { APP_MODE, firebaseConfig, isFirebaseConfigured } from '../config/runtimeConfig.js';
import {
  Chapter,
  Concept,
  Dataset,
  ImportBundle,
  Question,
  SCHEMA_VERSION,
  Subject,
  Tab,
  Unit,
  type Chapter as ChapterT,
  type Concept as ConceptT,
  type Dataset as DatasetT,
  type ImportBundle as ImportBundleT,
  type Question as QuestionT,
  type Subject as SubjectT,
  type Tab as TabT,
  type Unit as UnitT,
} from '../domain/content/schemas';
import { migrateLessonV1, type LessonV1 } from '../domain/content/migrations';
import { paths } from '../domain/content/ids';

export interface ContentBackend {
  list(collectionPath: string): Promise<Record<string, unknown>[]>;
  get(docPath: string): Promise<Record<string, unknown> | null>;
  set(docPath: string, data: Record<string, unknown>): Promise<void>;
  remove(docPath: string): Promise<void>;
}

const LOCAL_PREFIX = 'theolab:v2:';
const SEED_FLAG = 'theolab:v2:__seeded';

function sortByOrder<T extends { order?: number; title?: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.title ?? a.id).localeCompare(b.title ?? b.id, 'vi'));
}

function withTimestamps<T extends { created_at?: string; updated_at?: string }>(doc: T): T {
  const now = new Date().toISOString();
  return { ...doc, created_at: doc.created_at ?? now, updated_at: now };
}

/** Build the default local seed: Hóa phân tích ▸ Chương 3 ▸ Chuẩn độ axit yếu (2 tabs). */
export function buildInitialSeed(): ImportBundleT {
  const now = new Date().toISOString();
  const subjectId = 'hoa-phan-tich';
  const chapterId = 'c03-can-bang-axit-bazo';
  const subject = Subject.parse({
    id: subjectId,
    kind: 'subject',
    title: 'Hóa phân tích',
    code: 'ACHE231203',
    description: 'Cân bằng dung dịch, chuẩn độ thể tích, trọng lượng và xử lý số liệu phân tích.',
    order: 1000,
    clo: [
      { id: 'G1', text: 'Kiến thức khoa học cơ bản trong lĩnh vực hóa phân tích.' },
      { id: 'G2', text: 'Khả năng giải thích, phân tích và lập luận giải quyết vấn đề hóa phân tích.' },
    ],
    created_at: now,
    updated_at: now,
  });
  const chapter = Chapter.parse({
    id: chapterId,
    kind: 'chapter',
    subject_id: subjectId,
    title: 'Chương 3 · Cân bằng axit–bazơ',
    summary: 'Tính pH đơn/đa axit, dung dịch đệm, đường cong chuẩn độ và chọn chỉ thị.',
    order: 1000,
    clo_ids: ['G1', 'G2'],
    created_at: now,
    updated_at: now,
  });
  const migrated = migrateLessonV1(sampleLesson as LessonV1, { subjectId, chapterId, order: 1000 });
  const notesTab = Tab.parse({
    id: 'ghi-chu-nhanh',
    kind: 'tab',
    subject_id: subjectId,
    chapter_id: chapterId,
    unit_id: migrated.unit.id,
    title: 'Ghi chú & Công thức',
    type: 'notes',
    order: 2000,
    format: 'markdown',
    markdown: [
      '## Tóm tắt nhanh các vùng chuẩn độ',
      '',
      '- **Trước khi thêm bazơ ($V_b = 0$):** tính pH axit yếu từ $K_a$ và $C_a$.',
      '- **Vùng đệm ($0 < V_b < V_{td}$):** áp dụng Henderson–Hasselbalch:',
      '',
      '$$\\mathrm{pH} = \\mathrm{p}K_a + \\log\\frac{n_{A^-}}{n_{HA}}$$',
      '',
      '- **Tại nửa điểm tương đương:** $\\mathrm{pH} = \\mathrm{p}K_a$.',
      '- **Tại điểm tương đương:** dung dịch chứa bazơ liên hợp $A^-$ thủy phân nên $\\mathrm{pH} > 7$.',
      '',
      '> Bạn có thể bấm nút **＋** ngay thanh tab phía trên để thêm tab mới (Ví dụ, Bài tập, Tài liệu file, Ghi chú…) hoặc nạp file JSON.',
    ].join('\n'),
    created_at: now,
    updated_at: now,
  });
  return ImportBundle.parse({
    format: 'theolab-bundle',
    schema_version: SCHEMA_VERSION,
    subjects: [subject],
    chapters: [chapter],
    units: [migrated.unit],
    tabs: [...migrated.tabs, notesTab],
  });
}

/* ----------------------------------------------------------- Local backend */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

function browserLocalStore(): KeyValueStore {
  return {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k),
    keys: () => Object.keys(localStorage),
  };
}

export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    keys: () => [...map.keys()],
  };
}

export function createLocalBackend(store: KeyValueStore = browserLocalStore(), seedOnEmpty = true): ContentBackend {
  const ensureSeeded = () => {
    if (!seedOnEmpty || store.getItem(SEED_FLAG)) return;
    const seed = buildInitialSeed();
    for (const s of seed.subjects) store.setItem(`${LOCAL_PREFIX}${paths.subject(s.id)}`, JSON.stringify(s));
    for (const c of seed.chapters) store.setItem(`${LOCAL_PREFIX}${paths.chapter(c.subject_id, c.id)}`, JSON.stringify(c));
    for (const u of seed.units) store.setItem(`${LOCAL_PREFIX}${paths.unit(u.subject_id, u.chapter_id, u.id)}`, JSON.stringify(u));
    for (const t of seed.tabs) store.setItem(`${LOCAL_PREFIX}${paths.tab(t.subject_id, t.chapter_id, t.unit_id, t.id)}`, JSON.stringify(t));
    store.setItem(SEED_FLAG, '1');
  };

  return {
    async list(collectionPath) {
      ensureSeeded();
      const prefix = `${LOCAL_PREFIX}${collectionPath}/`;
      const results: Record<string, unknown>[] = [];
      for (const key of store.keys()) {
        if (!key.startsWith(prefix)) continue;
        const remainder = key.slice(prefix.length);
        // Only direct children of this collection (no nested subcollection docs).
        if (remainder.includes('/')) continue;
        const raw = store.getItem(key);
        if (raw) results.push(JSON.parse(raw) as Record<string, unknown>);
      }
      return results;
    },
    async get(docPath) {
      ensureSeeded();
      const raw = store.getItem(`${LOCAL_PREFIX}${docPath}`);
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    },
    async set(docPath, data) {
      ensureSeeded();
      store.setItem(`${LOCAL_PREFIX}${docPath}`, JSON.stringify(data));
    },
    async remove(docPath) {
      ensureSeeded();
      store.removeItem(`${LOCAL_PREFIX}${docPath}`);
      // Cascade-delete direct & nested children under this document path.
      const nestedPrefix = `${LOCAL_PREFIX}${docPath}/`;
      for (const key of store.keys()) {
        if (key.startsWith(nestedPrefix)) store.removeItem(key);
      }
    },
  };
}

/* ------------------------------------------------------- Firestore backend */

let firestoreInstance: unknown;

async function getFirestoreDb() {
  if (APP_MODE !== 'firebase_auth' || !isFirebaseConfigured()) {
    throw new Error('Firestore chưa được cấu hình. Hãy thiết lập .env.local (xem env.example).');
  }
  if (!firestoreInstance) {
    const [{ initializeApp, getApps }, { getFirestore }] = await Promise.all([
      import('firebase/app'),
      import('firebase/firestore'),
    ]);
    firestoreInstance = getFirestore(getApps()[0] ?? initializeApp(firebaseConfig));
  }
  return firestoreInstance as import('firebase/firestore').Firestore;
}

export function createFirestoreBackend(): ContentBackend {
  return {
    async list(collectionPath) {
      const db = await getFirestoreDb();
      const { collection, getDocs } = await import('firebase/firestore');
      const snap = await getDocs(collection(db, collectionPath));
      return snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    },
    async get(docPath) {
      const db = await getFirestoreDb();
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, docPath));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    },
    async set(docPath, data) {
      const db = await getFirestoreDb();
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, docPath), data);
    },
    async remove(docPath) {
      const db = await getFirestoreDb();
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, docPath));
    },
  };
}

/* -------------------------------------------------------------- Repository */

export interface ImportSummary {
  subjects: number;
  chapters: number;
  units: number;
  tabs: number;
  questions: number;
  datasets: number;
  concepts: number;
}

export function createContentRepository(backend: ContentBackend) {
  return {
    /* Subjects */
    async listSubjects(): Promise<SubjectT[]> {
      const raw = await backend.list(paths.subjects());
      return sortByOrder(raw.map((d) => Subject.parse(d)));
    },
    async saveSubject(input: z.input<typeof Subject>): Promise<SubjectT> {
      const doc = Subject.parse(withTimestamps(input));
      await backend.set(paths.subject(doc.id), doc);
      return doc;
    },
    async deleteSubject(subjectId: string): Promise<void> {
      await backend.remove(paths.subject(subjectId));
    },

    /* Chapters */
    async listChapters(subjectId: string): Promise<ChapterT[]> {
      const raw = await backend.list(paths.chapters(subjectId));
      return sortByOrder(raw.map((d) => Chapter.parse(d)));
    },
    async saveChapter(input: z.input<typeof Chapter>): Promise<ChapterT> {
      const doc = Chapter.parse(withTimestamps(input));
      await backend.set(paths.chapter(doc.subject_id, doc.id), doc);
      return doc;
    },
    async deleteChapter(subjectId: string, chapterId: string): Promise<void> {
      await backend.remove(paths.chapter(subjectId, chapterId));
    },

    /* Units */
    async listUnits(subjectId: string, chapterId: string): Promise<UnitT[]> {
      const raw = await backend.list(paths.units(subjectId, chapterId));
      return sortByOrder(raw.map((d) => Unit.parse(d)));
    },
    async getUnit(subjectId: string, chapterId: string, unitId: string): Promise<UnitT | null> {
      const raw = await backend.get(paths.unit(subjectId, chapterId, unitId));
      return raw ? Unit.parse(raw) : null;
    },
    async saveUnit(input: z.input<typeof Unit>): Promise<UnitT> {
      const doc = Unit.parse(withTimestamps(input));
      await backend.set(paths.unit(doc.subject_id, doc.chapter_id, doc.id), doc);
      return doc;
    },
    async deleteUnit(subjectId: string, chapterId: string, unitId: string): Promise<void> {
      await backend.remove(paths.unit(subjectId, chapterId, unitId));
    },

    /* Tabs */
    async listTabs(subjectId: string, chapterId: string, unitId: string): Promise<TabT[]> {
      const raw = await backend.list(paths.tabs(subjectId, chapterId, unitId));
      return sortByOrder(raw.map((d) => Tab.parse(d)));
    },
    async saveTab(input: z.input<typeof Tab>): Promise<TabT> {
      const doc = Tab.parse(withTimestamps(input));
      await backend.set(paths.tab(doc.subject_id, doc.chapter_id, doc.unit_id, doc.id), doc);
      return doc;
    },
    async deleteTab(subjectId: string, chapterId: string, unitId: string, tabId: string): Promise<void> {
      await backend.remove(paths.tab(subjectId, chapterId, unitId, tabId));
    },

    /* Shared collections */
    async listQuestions(): Promise<QuestionT[]> {
      return (await backend.list(paths.questions())).map((d) => Question.parse(d));
    },
    async saveQuestion(input: z.input<typeof Question>): Promise<QuestionT> {
      const doc = Question.parse(withTimestamps(input));
      await backend.set(paths.question(doc.id), doc);
      return doc;
    },
    async listDatasets(): Promise<DatasetT[]> {
      return (await backend.list(paths.datasets())).map((d) => Dataset.parse(d));
    },
    async saveDataset(input: z.input<typeof Dataset>): Promise<DatasetT> {
      const doc = Dataset.parse(withTimestamps(input));
      await backend.set(paths.dataset(doc.id), doc);
      return doc;
    },
    async listConcepts(): Promise<ConceptT[]> {
      return (await backend.list(paths.concepts())).map((d) => Concept.parse(d));
    },
    async saveConcept(input: z.input<typeof Concept>): Promise<ConceptT> {
      const doc = Concept.parse(withTimestamps(input));
      await backend.set(paths.concept(doc.id), doc);
      return doc;
    },

    /* Bundles */
    async importBundle(bundle: ImportBundleT): Promise<ImportSummary> {
      const valid = ImportBundle.parse(bundle);
      for (const s of valid.subjects) await this.saveSubject(s);
      for (const c of valid.chapters) await this.saveChapter(c);
      for (const u of valid.units) await this.saveUnit(u);
      for (const t of valid.tabs) await this.saveTab(t);
      for (const q of valid.questions) await this.saveQuestion(q);
      for (const d of valid.datasets) await this.saveDataset(d);
      for (const k of valid.concepts) await this.saveConcept(k);
      return {
        subjects: valid.subjects.length,
        chapters: valid.chapters.length,
        units: valid.units.length,
        tabs: valid.tabs.length,
        questions: valid.questions.length,
        datasets: valid.datasets.length,
        concepts: valid.concepts.length,
      };
    },

    async exportUnitBundle(subjectId: string, chapterId: string, unitId: string): Promise<ImportBundleT> {
      const unit = await this.getUnit(subjectId, chapterId, unitId);
      if (!unit) throw new Error(`Không tìm thấy bài học "${unitId}".`);
      const tabs = await this.listTabs(subjectId, chapterId, unitId);
      return ImportBundle.parse({
        format: 'theolab-bundle',
        schema_version: SCHEMA_VERSION,
        units: [unit],
        tabs,
      });
    },
  };
}

import type { z } from 'zod';

export const contentRepo = createContentRepository(
  APP_MODE === 'firebase_auth' ? createFirestoreBackend() : createLocalBackend(),
);
