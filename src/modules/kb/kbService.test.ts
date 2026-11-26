import { describe, expect, it, vi } from 'vitest';
import { createContentRepository, createLocalBackend, createMemoryStore } from '../../core/contentRepository';
import { getKbStats, searchKnowledgeBase, syncAndIndexKb } from './kbService';

describe('kbService incremental indexing & hybrid search', () => {
  it('embeds chunks with mocked Gemini API and searches hybrid + BM25', async () => {
    const repo = createContentRepository(createLocalBackend(createMemoryStore(), true));
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { requests: Array<{ content: { parts: Array<{ text: string }> } }> };
      return new Response(
        JSON.stringify({
          embeddings: body.requests.map((req) => {
            const text = req.content.parts[0]?.text.toLowerCase() ?? '';
            return { values: [text.includes('đệm') || text.includes('henderson') ? 1 : 0.1, text.includes('tương đương') ? 1 : 0.1] };
          }),
        }),
        { status: 200 },
      );
    });

    const first = await syncAndIndexKb({
      repo,
      apiKey: 'test-key',
      dims: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(first.embeddedNow).toBeGreaterThan(0);
    expect(first.stats.denseReady).toBe(true);
    expect(getKbStats().embeddedChunks).toBe(first.stats.totalChunks);

    const search = await searchKnowledgeBase('vùng đệm Henderson', {
      apiKey: 'test-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      k: 3,
    });
    expect(search.mode).toBe('hybrid');
    expect(search.hits.length).toBeGreaterThan(0);
    expect(search.hits[0]!.deep_link).toMatch(/^#\/hoa-phan-tich\//);
  });
});
