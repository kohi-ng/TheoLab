import { getActiveContext } from '../../../core/contextBus.js';
import { searchKnowledgeBase } from '../../kb/kbService.ts';

export async function search_vector_kb(query, options = {}) {
  const { hits, mode } = await searchKnowledgeBase(String(query ?? ''), {
    k: options.k ?? 6,
    filters: options.filters,
  });
  return {
    query: String(query ?? ''),
    mode,
    status: hits.length ? 'ok' : 'no_matches',
    results: hits.map((hit) => ({
      title: hit.title,
      breadcrumb: hit.breadcrumb,
      snippet: hit.snippet,
      deep_link: hit.deep_link,
      score: Number(hit.score.toFixed(4)),
    })),
  };
}

export function push_exercise_card(card, target) {
  if (!card || !target) throw new Error('Exercise card and target are required.');
  target.dispatchEvent(new CustomEvent('theolab:exercise', { detail: card }));
}

export function get_active_context() {
  return getActiveContext();
}

export const localFunctions = { search_vector_kb, push_exercise_card, get_active_context };
