/**
 * Gemini embedding client (browser, BYOK key).
 *
 * Default model: `gemini-embedding-2` (GA since 2026-04-22, multilingual + multimodal).
 * It does not accept `taskType`; the task is written into the text:
 *   query    → "task: search result | query: {q}"
 *   document → "title: {title} | text: {content}"
 * `gemini-embedding-001` is kept as a fallback and uses `taskType` instead.
 * Vectors from different models live in different spaces — never mix them in one index.
 */

export type EmbeddingModel = 'gemini-embedding-2' | 'gemini-embedding-001';
export type EmbedRole = 'query' | 'document';

export interface EmbeddingConfig {
  apiKey: string;
  model?: EmbeddingModel;
  /** 768 is the recommended quality/size trade-off (MRL). */
  dimensions?: number;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export const DEFAULT_EMBEDDING_MODEL: EmbeddingModel = 'gemini-embedding-2';
export const DEFAULT_DIMENSIONS = 768;
const BATCH_LIMIT = 100;
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

export function formatForEmbedding(model: EmbeddingModel, role: EmbedRole, text: string, title?: string): string {
  if (model !== 'gemini-embedding-2') return text;
  return role === 'query'
    ? `task: search result | query: ${text}`
    : `title: ${title?.trim() || 'none'} | text: ${text}`;
}

export function l2normalize(values: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(values);
  let norm = 0;
  for (let i = 0; i < out.length; i += 1) norm += out[i]! * out[i]!;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < out.length; i += 1) out[i]! /= norm;
  return out;
}

export interface EmbedInput {
  text: string;
  title?: string;
}

export class EmbeddingError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/** Embeds texts in batches of ≤100. Returns unit-length Float32Arrays in input order. */
export async function embedTexts(inputs: EmbedInput[], role: EmbedRole, config: EmbeddingConfig): Promise<Float32Array[]> {
  if (!config.apiKey) throw new EmbeddingError('Chưa có Google AI Studio API key (Cấu hình → Cấu hình AI → Google AI Studio).');
  const model = config.model ?? DEFAULT_EMBEDDING_MODEL;
  const dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
  const doFetch = config.fetchImpl ?? fetch;
  const results: Float32Array[] = [];
  for (let start = 0; start < inputs.length; start += BATCH_LIMIT) {
    const batch = inputs.slice(start, start + BATCH_LIMIT);
    const body = {
      requests: batch.map((input) => ({
        model: `models/${model}`,
        content: { parts: [{ text: formatForEmbedding(model, role, input.text, input.title) }] },
        outputDimensionality: dimensions,
        ...(model === 'gemini-embedding-001'
          ? { taskType: role === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT', ...(role === 'document' && input.title ? { title: input.title } : {}) }
          : {}),
      })),
    };
    const response = await doFetch(`${config.endpoint ?? ENDPOINT}/models/${model}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let detail = '';
      try {
        detail = ((await response.json()) as { error?: { message?: string } }).error?.message ?? '';
      } catch {
        /* ignore non-JSON error bodies */
      }
      throw new EmbeddingError(`Gemini embedding lỗi ${response.status}${detail ? `: ${detail}` : ''}`, response.status);
    }
    const json = (await response.json()) as { embeddings?: Array<{ values?: number[] }> };
    const embeddings = json.embeddings ?? [];
    if (embeddings.length !== batch.length) throw new EmbeddingError('Số embedding trả về không khớp số đầu vào.');
    for (const embedding of embeddings) {
      if (!embedding.values?.length) throw new EmbeddingError('Gemini trả về embedding rỗng.');
      results.push(l2normalize(embedding.values));
    }
  }
  return results;
}
