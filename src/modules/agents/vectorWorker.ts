/// <reference lib="webworker" />
/**
 * Vector KB worker. Keeps the hybrid index off the main thread.
 * Messages are plain data (no functions); all text is treated as untrusted.
 */
import { HybridIndex, fromBase64, type IndexedDoc, type SearchFilters } from '../../domain/kb/hybridSearch';

export interface WorkerChunk extends IndexedDoc {
  vector_b64?: string;
  scale?: number;
}

export type VectorWorkerRequest =
  | { type: 'load'; requestId: number; chunks: WorkerChunk[]; dims: number }
  | { type: 'search'; requestId: number; text: string; vector?: Float32Array; k?: number; filters?: SearchFilters };

export type VectorWorkerResponse =
  | { type: 'loaded'; requestId: number; size: number; dense: boolean }
  | { type: 'results'; requestId: number; hits: ReturnType<HybridIndex['search']> }
  | { type: 'error'; requestId: number; message: string };

let index: HybridIndex | null = null;

self.onmessage = (event: MessageEvent<VectorWorkerRequest>) => {
  const message = event.data;
  const reply = (response: VectorWorkerResponse) => self.postMessage(response);
  try {
    if (message.type === 'load') {
      const withVectors = message.chunks.every((chunk) => chunk.vector_b64 && typeof chunk.scale === 'number');
      const vectors = withVectors
        ? message.chunks.map((chunk) => ({ data: fromBase64(chunk.vector_b64!), scale: chunk.scale! }))
        : undefined;
      const docs = message.chunks.map(({ vector_b64: _v, scale: _s, ...doc }) => doc);
      index = new HybridIndex(docs, vectors, withVectors ? message.dims : undefined);
      reply({ type: 'loaded', requestId: message.requestId, size: docs.length, dense: withVectors });
    } else if (message.type === 'search') {
      if (!index) throw new Error('Chưa nạp index.');
      reply({
        type: 'results',
        requestId: message.requestId,
        hits: index.search({ text: message.text, vector: message.vector, k: message.k, filters: message.filters }),
      });
    }
  } catch (error) {
    reply({ type: 'error', requestId: message.requestId, message: (error as Error).message });
  }
};
