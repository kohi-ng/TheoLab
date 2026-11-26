import { describe, expect, it, vi } from 'vitest';
import { chunkTab, contentHash, splitMarkdown } from './chunking';
import { embedTexts, formatForEmbedding, l2normalize } from './embeddingClient';
import { Bm25Index, HybridIndex, fromBase64, quantize, reciprocalRankFusion, toBase64, tokenize } from './hybridSearch';
import type { Tab } from '../content/schemas';

const ctx = {
  subject: { id: 'hoa-phan-tich', title: 'Hóa phân tích' },
  chapter: { id: 'c03', title: 'Cân bằng axit–bazơ' },
  unit: { id: 'u02', title: 'Chuẩn độ đa axit', concepts: ['h3po4'] },
};

describe('chunking', () => {
  const tab: Tab = {
    id: 'ly-thuyet', schema_version: '2.0.0', kind: 'tab', subject_id: 'hoa-phan-tich', chapter_id: 'c03', unit_id: 'u02',
    title: 'Lý thuyết', type: 'theory', order: 1, format: 'blocks',
    blocks: [
      { id: 'vung-dem', type: 'theory', title: 'Vùng đệm', content: 'pH = pKa + log(A-/HA)', concepts: ['dem'] },
      { id: 'q', type: 'mcq', question: 'Nửa điểm tương đương?', options: [{ text: 'pKa' }, { text: '7' }], answer: 0 },
      { id: 'w', type: 'widget_embed', file: 'demo.html' },
    ],
  };
  it('makes one chunk per text-bearing block with breadcrumb and deep link', () => {
    const chunks = chunkTab(tab, ctx);
    expect(chunks.map((c) => c.block_id)).toEqual(['vung-dem', 'q']);
    expect(chunks[0]!.breadcrumb).toBe('Hóa phân tích › Cân bằng axit–bazơ › Chuẩn độ đa axit › Lý thuyết › Vùng đệm');
    expect(chunks[0]!.deep_link).toBe('#/hoa-phan-tich/c03/u02/ly-thuyet#vung-dem');
    expect(chunks[0]!.concepts).toEqual(['h3po4', 'dem']);
    expect(chunks[1]!.text).toContain('(đúng) pKa');
  });
  it('splits markdown by headings and size', () => {
    const sections = splitMarkdown(`# A\nxin chao\n## B\n${'x'.repeat(50)}\n\n${'y'.repeat(50)}`, 60);
    expect(sections.map((s) => s.heading)).toEqual(['A', 'B', 'B']);
  });
  it('hash changes with model or dims', async () => {
    const a = await contentHash('t', 'gemini-embedding-2', 768);
    expect(a).toHaveLength(64);
    expect(await contentHash('t', 'gemini-embedding-2', 1536)).not.toBe(a);
    expect(await contentHash('t', 'gemini-embedding-001', 768)).not.toBe(a);
  });
});

describe('embedding client', () => {
  it('formats task prefixes for gemini-embedding-2 only', () => {
    expect(formatForEmbedding('gemini-embedding-2', 'query', 'pH là gì')).toBe('task: search result | query: pH là gì');
    expect(formatForEmbedding('gemini-embedding-2', 'document', 'nội dung', 'Vùng đệm')).toBe('title: Vùng đệm | text: nội dung');
    expect(formatForEmbedding('gemini-embedding-001', 'query', 'x')).toBe('x');
  });
  it('batches requests and normalises vectors', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { requests: unknown[] };
      return new Response(JSON.stringify({ embeddings: body.requests.map(() => ({ values: [3, 4] })) }), { status: 200 });
    });
    const inputs = Array.from({ length: 150 }, (_, i) => ({ text: `t${i}` }));
    const vectors = await embedTexts(inputs, 'document', { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch, dimensions: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(150);
    expect(vectors[0]![0]).toBeCloseTo(0.6);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('gemini-embedding-2:batchEmbedContents');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    expect(String(init.body)).not.toContain('taskType');
  });
  it('surfaces API errors', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 });
    await expect(embedTexts([{ text: 'x' }], 'query', { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/400: API key not valid/);
  });
  it('requires an API key', async () => {
    await expect(embedTexts([{ text: 'x' }], 'query', { apiKey: '' })).rejects.toThrow(/API key/);
  });
});

describe('hybrid search', () => {
  it('tokenizes Vietnamese and chemistry notation', () => {
    expect(tokenize('Chuẩn độ H3PO4 bằng EDTA, αY4-')).toEqual(['chuan', 'do', 'h3po4', 'bang', 'edta', 'αy4']);
  });
  it('quantises with small error and round-trips base64', () => {
    const v = l2normalize([0.1, -0.5, 0.3, 0.7]);
    const q = quantize(v);
    const back = fromBase64(toBase64(q.data));
    expect([...back]).toEqual([...q.data]);
    back.forEach((value, i) => expect(Math.abs(value * q.scale - v[i]!)).toBeLessThan(0.01));
  });
  it('ranks BM25 matches', () => {
    const bm25 = new Bm25Index([{ text: 'chuẩn độ phức chất EDTA' }, { text: 'cân bằng axit bazơ' }]);
    expect(bm25.search('edta')[0]!.index).toBe(0);
  });
  it('fuses rankings with RRF', () => {
    const fused = reciprocalRankFusion([[{ index: 1 }, { index: 2 }], [{ index: 2 }, { index: 3 }]]);
    expect([...fused].sort((a, b) => b[1] - a[1])[0]![0]).toBe(2);
  });
  it('combines dense + lexical and applies filters', () => {
    const docs = [
      { id: 'a', text: 'Chuẩn độ EDTA tạo phức Cu2+', subject_id: 's', chapter_id: 'c4' },
      { id: 'b', text: 'Dung dịch đệm và Henderson', subject_id: 's', chapter_id: 'c3' },
      { id: 'c', text: 'Phân tích trọng lượng tro polymer', subject_id: 's', chapter_id: 'c6' },
    ];
    const vecs = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => quantize(l2normalize(v)));
    const index = new HybridIndex(docs, vecs, 3);
    const hits = index.search({ text: 'đệm', vector: l2normalize([0.1, 1, 0]), k: 2 });
    expect(hits[0]!.id).toBe('b');
    const filtered = index.search({ text: 'chuẩn độ', vector: l2normalize([1, 0, 0]), filters: { chapter_id: 'c6' } });
    expect(filtered.map((h) => h.id)).toEqual(['c']);
  });
});
