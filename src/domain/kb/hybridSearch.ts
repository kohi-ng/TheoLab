/**
 * In-browser hybrid retrieval: int8-quantised dense vectors + BM25 over
 * diacritic-folded tokens, fused with Reciprocal Rank Fusion.
 *
 * Why client-side: Firestore's KNN `findNearest` is server-SDK only. For a single-owner
 * corpus (≤ ~50k chunks × 768 dims ≈ 37 MB int8) an exhaustive scan in a Web Worker is
 * exact, takes milliseconds, and needs no Cloud Functions.
 */

/* --------------------------------------------------------- Quantisation */

export interface QuantizedVector {
  data: Int8Array;
  scale: number;
}

export function quantize(vector: ArrayLike<number>): QuantizedVector {
  let max = 0;
  for (let i = 0; i < vector.length; i += 1) max = Math.max(max, Math.abs(vector[i]!));
  const scale = max > 0 ? max / 127 : 1;
  const data = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) data[i] = Math.round(vector[i]! / scale);
  return { data, scale };
}

export function toBase64(bytes: Int8Array): string {
  const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let binary = '';
  for (let i = 0; i < u8.length; i += 1) binary += String.fromCharCode(u8[i]!);
  return btoa(binary);
}

export function fromBase64(b64: string): Int8Array {
  const binary = atob(b64);
  const out = new Int8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = (binary.charCodeAt(i) << 24) >> 24;
  return out;
}

/* ------------------------------------------------------------- Lexical */

/** Lowercase, strip Vietnamese diacritics, đ→d; keeps chemistry tokens like h3po4, edta, αy4. */
export function tokenize(text: string): string[] {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

export interface IndexedDoc {
  id: string;
  text: string;
  /** Optional facets used by filters. */
  subject_id?: string;
  chapter_id?: string;
  unit_id?: string;
  source?: string;
}

export class Bm25Index {
  private readonly postings = new Map<string, Map<number, number>>();
  private readonly lengths: number[] = [];
  private avgLength = 0;

  constructor(docs: Array<Pick<IndexedDoc, 'text'>>, private readonly k1 = 1.2, private readonly b = 0.75) {
    docs.forEach((doc, index) => {
      const tokens = tokenize(doc.text);
      this.lengths[index] = tokens.length;
      for (const token of tokens) {
        let posting = this.postings.get(token);
        if (!posting) this.postings.set(token, (posting = new Map()));
        posting.set(index, (posting.get(index) ?? 0) + 1);
      }
    });
    this.avgLength = this.lengths.reduce((sum, n) => sum + n, 0) / Math.max(1, this.lengths.length);
  }

  search(query: string, allowed?: (index: number) => boolean): Array<{ index: number; score: number }> {
    const n = this.lengths.length;
    const scores = new Map<number, number>();
    for (const token of new Set(tokenize(query))) {
      const posting = this.postings.get(token);
      if (!posting) continue;
      const idf = Math.log(1 + (n - posting.size + 0.5) / (posting.size + 0.5));
      for (const [index, tf] of posting) {
        if (allowed && !allowed(index)) continue;
        const norm = tf + this.k1 * (1 - this.b + (this.b * this.lengths[index]!) / this.avgLength);
        scores.set(index, (scores.get(index) ?? 0) + (idf * tf * (this.k1 + 1)) / norm);
      }
    }
    return [...scores].map(([index, score]) => ({ index, score })).sort((a, b) => b.score - a.score);
  }
}

/* --------------------------------------------------------------- Dense */

export class DenseIndex {
  readonly dims: number;
  private readonly matrix: Int8Array;
  private readonly scales: Float32Array;

  constructor(vectors: QuantizedVector[], dims: number) {
    this.dims = dims;
    this.matrix = new Int8Array(vectors.length * dims);
    this.scales = new Float32Array(vectors.length);
    vectors.forEach((vector, row) => {
      if (vector.data.length !== dims) throw new Error(`Vector ${row} có ${vector.data.length} chiều, cần ${dims}.`);
      this.matrix.set(vector.data, row * dims);
      this.scales[row] = vector.scale;
    });
  }

  get size(): number {
    return this.scales.length;
  }

  /** Cosine similarity for unit-length stored vectors and a unit-length query. */
  search(query: Float32Array, allowed?: (index: number) => boolean): Array<{ index: number; score: number }> {
    if (query.length !== this.dims) throw new Error(`Query có ${query.length} chiều, index có ${this.dims}.`);
    const out: Array<{ index: number; score: number }> = [];
    for (let row = 0; row < this.scales.length; row += 1) {
      if (allowed && !allowed(row)) continue;
      const offset = row * this.dims;
      let dot = 0;
      for (let i = 0; i < this.dims; i += 1) dot += query[i]! * this.matrix[offset + i]!;
      out.push({ index: row, score: dot * this.scales[row]! });
    }
    return out.sort((a, b) => b.score - a.score);
  }
}

/* -------------------------------------------------------------- Hybrid */

export interface SearchFilters {
  subject_id?: string;
  chapter_id?: string;
  unit_id?: string;
  sources?: string[];
}

export interface HybridHit {
  id: string;
  index: number;
  score: number;
  dense?: number;
  lexical?: number;
}

/** Reciprocal Rank Fusion (Cormack et al., 2009). k=60 is the standard constant. */
export function reciprocalRankFusion(rankings: Array<Array<{ index: number }>>, k = 60): Map<number, number> {
  const fused = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((hit, rank) => fused.set(hit.index, (fused.get(hit.index) ?? 0) + 1 / (k + rank + 1)));
  }
  return fused;
}

export class HybridIndex {
  private readonly bm25: Bm25Index;
  private readonly dense?: DenseIndex;

  constructor(private readonly docs: IndexedDoc[], vectors?: QuantizedVector[], dims?: number) {
    this.bm25 = new Bm25Index(docs);
    if (vectors && dims) {
      if (vectors.length !== docs.length) throw new Error('Số vector phải bằng số tài liệu.');
      this.dense = new DenseIndex(vectors, dims);
    }
  }

  private filter(filters?: SearchFilters): ((index: number) => boolean) | undefined {
    if (!filters) return undefined;
    return (index) => {
      const doc = this.docs[index]!;
      if (filters.subject_id && doc.subject_id !== filters.subject_id) return false;
      if (filters.chapter_id && doc.chapter_id !== filters.chapter_id) return false;
      if (filters.unit_id && doc.unit_id !== filters.unit_id) return false;
      if (filters.sources?.length && !filters.sources.includes(doc.source ?? '')) return false;
      return true;
    };
  }

  search(params: { text: string; vector?: Float32Array; k?: number; filters?: SearchFilters; depth?: number }): HybridHit[] {
    const k = params.k ?? 8;
    const depth = params.depth ?? 50;
    const allowed = this.filter(params.filters);
    const lexical = this.bm25.search(params.text, allowed).slice(0, depth);
    const dense = params.vector && this.dense ? this.dense.search(params.vector, allowed).slice(0, depth) : [];
    const fused = reciprocalRankFusion([dense, lexical].filter((r) => r.length));
    const denseScore = new Map(dense.map((h) => [h.index, h.score]));
    const lexicalScore = new Map(lexical.map((h) => [h.index, h.score]));
    return [...fused]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([index, score]) => ({
        id: this.docs[index]!.id,
        index,
        score,
        dense: denseScore.get(index),
        lexical: lexicalScore.get(index),
      }));
  }
}
