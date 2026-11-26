/**
 * Phase 4 Vector Knowledge Base service.
 *
 * - Collects chunks from the v2 content tree (Subjects ▸ Chapters ▸ Units ▸ Tabs,
 *   plus Questions, Datasets, Concepts).
 * - Incrementally embeds only chunks whose `content_hash` changed using Gemini
 *   `gemini-embedding-2` (768 dims, int8-quantised).
 * - Persists `kb_chunks` in Firestore (owner-only) + caches locally in IndexedDB.
 * - Executes hybrid search (int8 Dense + Vietnamese BM25 + RRF) inside `vectorWorker.ts`
 *   (falling back to in-process HybridIndex in non-Worker environments like tests).
 */
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { APP_MODE, firebaseConfig, isFirebaseConfigured } from '../../config/runtimeConfig.js';
import { contentRepo } from '../../core/contentRepository';
import { toFirestoreData } from '../../core/firestoreData';
import { getApiKey } from '../../core/dataGateway.js';
import { getCachedVault } from '../../core/secretsVault';
import {
  chunkConcept,
  chunkDataset,
  chunkQuestion,
  chunkTab,
  contentHash,
  type KbChunkDraft,
} from '../../domain/kb/chunking';
import {
  DEFAULT_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  embedTexts,
  type EmbeddingModel,
} from '../../domain/kb/embeddingClient';
import {
  HybridIndex,
  fromBase64,
  quantize,
  toBase64,
  type SearchFilters,
} from '../../domain/kb/hybridSearch';
import type { VectorWorkerRequest, VectorWorkerResponse, WorkerChunk } from '../agents/vectorWorker';

export interface StoredKbChunk extends KbChunkDraft {
  content_hash: string;
  model: EmbeddingModel;
  dims: number;
  vector_b64?: string;
  scale?: number;
  updated_at: string;
}

export interface KbSearchResult {
  id: string;
  source: KbChunkDraft['source'];
  title: string;
  breadcrumb: string;
  snippet: string;
  deep_link: string;
  score: number;
  dense?: number;
  lexical?: number;
  subject_id: string;
  chapter_id?: string;
  unit_id?: string;
  tab_id?: string;
  block_id?: string;
}

export interface KbStats {
  totalChunks: number;
  embeddedChunks: number;
  model: EmbeddingModel;
  dims: number;
  denseReady: boolean;
  lastSyncedAt: string | null;
}

export interface SyncProgress {
  stage: 'collecting' | 'embedding' | 'saving' | 'loading' | 'done';
  completed: number;
  total: number;
  message: string;
}

const IDB_KEY = 'theolab:kb-chunks:v1';
const IDB_META_KEY = 'theolab:kb-meta:v1';

let chunksById = new Map<string, StoredKbChunk>();
let orderedChunks: StoredKbChunk[] = [];
let denseReady = false;
let lastSyncedAt: string | null = null;
let loaded = false;

let worker: Worker | null = null;
let workerReqId = 0;
const pendingWorker = new Map<number, { resolve: (res: VectorWorkerResponse) => void; reject: (err: Error) => void }>();
let fallbackIndex: HybridIndex | null = null;

function resolveGeminiKey(): string {
  return getCachedVault().geminiApiKey || getApiKey('google') || '';
}

async function getFirestoreDb() {
  if (APP_MODE !== 'firebase_auth' || !isFirebaseConfigured()) return null;
  const [{ initializeApp, getApps }, { getFirestore }] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
  ]);
  return getFirestore(getApps()[0] ?? initializeApp(firebaseConfig));
}

async function readLocalCache(): Promise<{ chunks: StoredKbChunk[]; lastSyncedAt: string | null }> {
  try {
    const [chunks, meta] = await Promise.all([
      idbGet<StoredKbChunk[]>(IDB_KEY),
      idbGet<{ lastSyncedAt?: string }>(IDB_META_KEY),
    ]);
    return {
      chunks: Array.isArray(chunks) ? chunks : [],
      lastSyncedAt: meta?.lastSyncedAt ?? null,
    };
  } catch {
    return { chunks: [], lastSyncedAt: null };
  }
}

async function writeLocalCache(chunks: StoredKbChunk[], syncedAt: string): Promise<void> {
  try {
    await Promise.all([
      idbSet(IDB_KEY, chunks),
      idbSet(IDB_META_KEY, { lastSyncedAt: syncedAt }),
    ]);
  } catch {
    /* IndexedDB unavailable in non-browser tests */
  }
}

function ensureWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    worker = new Worker(new URL('../agents/vectorWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<VectorWorkerResponse>) => {
      const response = event.data;
      const entry = pendingWorker.get(response.requestId);
      if (!entry) return;
      pendingWorker.delete(response.requestId);
      if (response.type === 'error') entry.reject(new Error(response.message));
      else entry.resolve(response);
    };
    worker.onerror = (event) => {
      const err = new Error(event.message || 'Vector worker error');
      pendingWorker.forEach((entry) => entry.reject(err));
      pendingWorker.clear();
    };
  }
  return worker;
}

type WorkerPayload =
  | { type: 'load'; chunks: WorkerChunk[]; dims: number }
  | { type: 'search'; text: string; vector?: Float32Array; k?: number; filters?: SearchFilters };

function postToWorker(request: WorkerPayload): Promise<VectorWorkerResponse> {
  const w = ensureWorker();
  if (!w) return Promise.reject(new Error('Worker unavailable'));
  const requestId = ++workerReqId;
  return new Promise((resolve, reject) => {
    pendingWorker.set(requestId, { resolve, reject });
    w.postMessage({ ...request, requestId });
  });
}

async function loadChunksIntoIndex(chunks: StoredKbChunk[]): Promise<void> {
  orderedChunks = chunks;
  chunksById = new Map(chunks.map((c) => [c.id, c]));
  const allHaveVectors = chunks.length > 0 && chunks.every((c) => Boolean(c.vector_b64) && typeof c.scale === 'number');
  const dims = chunks[0]?.dims ?? DEFAULT_DIMENSIONS;

  const workerChunks: WorkerChunk[] = chunks.map((c) => ({
    id: c.id,
    text: `${c.breadcrumb}\n${c.text}`,
    subject_id: c.subject_id,
    chapter_id: c.chapter_id,
    unit_id: c.unit_id,
    source: c.source,
    vector_b64: allHaveVectors ? c.vector_b64 : undefined,
    scale: allHaveVectors ? c.scale : undefined,
  }));

  if (typeof Worker !== 'undefined') {
    const res = await postToWorker({ type: 'load', chunks: workerChunks, dims });
    denseReady = res.type === 'loaded' ? res.dense : false;
    fallbackIndex = null;
  } else {
    const vectors = allHaveVectors
      ? chunks.map((c) => ({ data: fromBase64(c.vector_b64!), scale: c.scale! }))
      : undefined;
    fallbackIndex = new HybridIndex(workerChunks, vectors, allHaveVectors ? dims : undefined);
    denseReady = allHaveVectors;
  }
  loaded = true;
}

export async function collectAllChunkDrafts(repo = contentRepo): Promise<KbChunkDraft[]> {
  const drafts: KbChunkDraft[] = [];
  const subjects = await repo.listSubjects();
  const subjectTitleById = new Map(subjects.map((s) => [s.id, s.title]));

  for (const subject of subjects) {
    const chapters = await repo.listChapters(subject.id);
    for (const chapter of chapters) {
      const units = await repo.listUnits(subject.id, chapter.id);
      for (const unit of units) {
        const tabs = await repo.listTabs(subject.id, chapter.id, unit.id);
        for (const tab of tabs) {
          drafts.push(...chunkTab(tab, { subject, chapter, unit }));
        }
      }
    }
  }

  const [questions, datasets, concepts] = await Promise.all([
    repo.listQuestions(),
    repo.listDatasets(),
    repo.listConcepts(),
  ]);
  for (const q of questions) drafts.push(chunkQuestion(q, subjectTitleById.get(q.subject_id) ?? q.subject_id));
  for (const d of datasets) drafts.push(chunkDataset(d));
  for (const c of concepts) drafts.push(chunkConcept(c));
  return drafts;
}

/** Ensures the search index is hydrated (IndexedDB → Firestore → live contentRepo BM25). */
export async function ensureKbLoaded(): Promise<KbStats> {
  if (loaded && orderedChunks.length > 0) return getKbStats();

  const cached = await readLocalCache();
  if (cached.chunks.length > 0) {
    lastSyncedAt = cached.lastSyncedAt;
    await loadChunksIntoIndex(cached.chunks);
    return getKbStats();
  }

  // Try Firestore `kb_chunks` if in firebase_auth mode.
  const db = await getFirestoreDb().catch(() => null);
  if (db) {
    try {
      const { collection, getDocs } = await import('firebase/firestore');
      const snap = await getDocs(collection(db, 'kb_chunks'));
      const remote = snap.docs.map((entry) => entry.data() as StoredKbChunk);
      if (remote.length > 0) {
        lastSyncedAt = new Date().toISOString();
        await writeLocalCache(remote, lastSyncedAt);
        await loadChunksIntoIndex(remote);
        return getKbStats();
      }
    } catch {
      /* User may not be signed in yet; fall back to local BM25 */
    }
  }

  // Fall back to building an immediate BM25 index from current contentRepo.
  const drafts = await collectAllChunkDrafts();
  const now = new Date().toISOString();
  const lexicalOnly: StoredKbChunk[] = await Promise.all(
    drafts.map(async (draft) => ({
      ...draft,
      content_hash: await contentHash(`${draft.breadcrumb}\n${draft.text}`, DEFAULT_EMBEDDING_MODEL, DEFAULT_DIMENSIONS),
      model: DEFAULT_EMBEDDING_MODEL,
      dims: DEFAULT_DIMENSIONS,
      updated_at: now,
    })),
  );
  await loadChunksIntoIndex(lexicalOnly);
  return getKbStats();
}

/**
 * Incrementally re-indexes all content:
 * - Only embeds chunks whose `content_hash` changed or lack a vector.
 * - Saves updated chunks to Firestore `kb_chunks` (in `firebase_auth`) and IndexedDB.
 */
export async function syncAndIndexKb(options: {
  apiKey?: string;
  model?: EmbeddingModel;
  dims?: number;
  repo?: typeof contentRepo;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: SyncProgress) => void;
} = {}): Promise<{ stats: KbStats; embeddedNow: number; reused: number; removed: number }> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const dims = options.dims ?? DEFAULT_DIMENSIONS;
  const apiKey = options.apiKey ?? resolveGeminiKey();
  const report = options.onProgress;

  report?.({ stage: 'collecting', completed: 0, total: 0, message: 'Đang gom nội dung các môn, chương, bài, tab…' });
  const drafts = await collectAllChunkDrafts(options.repo ?? contentRepo);

  // Merge existing cached chunks + remote Firestore chunks (if signed in).
  const existingMap = new Map<string, StoredKbChunk>();
  const cached = await readLocalCache();
  cached.chunks.forEach((c) => existingMap.set(c.id, c));
  const db = await getFirestoreDb().catch(() => null);
  if (db) {
    try {
      const { collection, getDocs } = await import('firebase/firestore');
      const snap = await getDocs(collection(db, 'kb_chunks'));
      snap.docs.forEach((entry) => {
        const data = entry.data() as StoredKbChunk;
        existingMap.set(data.id, data);
      });
    } catch {
      /* ignore if offline or unauthenticated */
    }
  }

  const hashed = await Promise.all(
    drafts.map(async (draft) => ({
      draft,
      hash: await contentHash(`${draft.breadcrumb}\n${draft.text}`, model, dims),
    })),
  );

  const toEmbed: Array<{ draft: KbChunkDraft; hash: string }> = [];
  const nextChunks: StoredKbChunk[] = [];
  let reused = 0;

  for (const item of hashed) {
    const prev = existingMap.get(item.draft.id);
    if (prev && prev.content_hash === item.hash && prev.model === model && prev.dims === dims && prev.vector_b64) {
      nextChunks.push(prev);
      reused += 1;
    } else {
      toEmbed.push(item);
    }
  }

  const now = new Date().toISOString();
  let embeddedNow = 0;
  const changedForRemote: StoredKbChunk[] = [];

  if (toEmbed.length > 0 && apiKey) {
    report?.({ stage: 'embedding', completed: 0, total: toEmbed.length, message: `Đang tạo vector cho ${toEmbed.length} đoạn mới/thay đổi…` });
    const vectors = await embedTexts(
      toEmbed.map((item) => ({ title: item.draft.breadcrumb, text: item.draft.text })),
      'document',
      { apiKey, model, dimensions: dims, fetchImpl: options.fetchImpl },
    );
    toEmbed.forEach((item, index) => {
      const q = quantize(vectors[index]!);
      const stored: StoredKbChunk = {
        ...item.draft,
        content_hash: item.hash,
        model,
        dims,
        vector_b64: toBase64(q.data),
        scale: q.scale,
        updated_at: now,
      };
      nextChunks.push(stored);
      changedForRemote.push(stored);
      embeddedNow += 1;
    });
  } else {
    for (const item of toEmbed) {
      const stored: StoredKbChunk = {
        ...item.draft,
        content_hash: item.hash,
        model,
        dims,
        updated_at: now,
      };
      nextChunks.push(stored);
      changedForRemote.push(stored);
    }
  }

  const validIds = new Set(nextChunks.map((c) => c.id));
  const staleIds = [...existingMap.keys()].filter((id) => !validIds.has(id));

  if (db) {
    report?.({ stage: 'saving', completed: 0, total: changedForRemote.length + staleIds.length, message: 'Đang đồng bộ lên Firestore kb_chunks…' });
    try {
      const { deleteDoc, doc, setDoc } = await import('firebase/firestore');
      for (const chunk of changedForRemote) {
        await setDoc(doc(db, 'kb_chunks', chunk.id), toFirestoreData(chunk));
      }
      for (const staleId of staleIds) {
        await deleteDoc(doc(db, 'kb_chunks', staleId));
      }
    } catch {
      /* keep local cache even if remote sync fails */
    }
  }

  lastSyncedAt = now;
  await writeLocalCache(nextChunks, now);
  report?.({ stage: 'loading', completed: nextChunks.length, total: nextChunks.length, message: 'Đang nạp vào Web Worker…' });
  await loadChunksIntoIndex(nextChunks);
  report?.({ stage: 'done', completed: nextChunks.length, total: nextChunks.length, message: 'Hoàn tất đồng bộ Vector KB.' });

  return { stats: getKbStats(), embeddedNow, reused, removed: staleIds.length };
}

export async function searchKnowledgeBase(
  query: string,
  options: { k?: number; filters?: SearchFilters; apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ hits: KbSearchResult[]; mode: 'hybrid' | 'bm25' }> {
  const trimmed = query.trim();
  if (!trimmed) return { hits: [], mode: denseReady ? 'hybrid' : 'bm25' };
  await ensureKbLoaded();
  if (orderedChunks.length === 0) return { hits: [], mode: 'bm25' };

  const apiKey = options.apiKey ?? resolveGeminiKey();
  let queryVector: Float32Array | undefined;
  if (denseReady && apiKey) {
    try {
      const dims = orderedChunks[0]?.dims ?? DEFAULT_DIMENSIONS;
      const model = orderedChunks[0]?.model ?? DEFAULT_EMBEDDING_MODEL;
      const [vec] = await embedTexts([{ text: trimmed }], 'query', {
        apiKey,
        model,
        dimensions: dims,
        fetchImpl: options.fetchImpl,
      });
      queryVector = vec;
    } catch {
      /* gracefully fall back to BM25 if query embedding fails */
    }
  }

  const k = options.k ?? 8;
  let rawHits: Array<{ id: string; score: number; dense?: number; lexical?: number }> = [];
  if (typeof Worker !== 'undefined') {
    const res = await postToWorker({ type: 'search', text: trimmed, vector: queryVector, k, filters: options.filters });
    if (res.type === 'results') rawHits = res.hits;
  } else if (fallbackIndex) {
    rawHits = fallbackIndex.search({ text: trimmed, vector: queryVector, k, filters: options.filters });
  }

  const hits: KbSearchResult[] = rawHits.flatMap((hit) => {
    const chunk = chunksById.get(hit.id);
    if (!chunk) return [];
    return [{
      id: chunk.id,
      source: chunk.source,
      title: chunk.title,
      breadcrumb: chunk.breadcrumb,
      snippet: chunk.text.slice(0, 220),
      deep_link: chunk.deep_link,
      score: hit.score,
      dense: hit.dense,
      lexical: hit.lexical,
      subject_id: chunk.subject_id,
      chapter_id: chunk.chapter_id,
      unit_id: chunk.unit_id,
      tab_id: chunk.tab_id,
      block_id: chunk.block_id,
    }];
  });

  return { hits, mode: queryVector ? 'hybrid' : 'bm25' };
}

export function getKbStats(): KbStats {
  const embeddedChunks = orderedChunks.filter((c) => Boolean(c.vector_b64)).length;
  return {
    totalChunks: orderedChunks.length,
    embeddedChunks,
    model: orderedChunks[0]?.model ?? DEFAULT_EMBEDDING_MODEL,
    dims: orderedChunks[0]?.dims ?? DEFAULT_DIMENSIONS,
    denseReady,
    lastSyncedAt,
  };
}
