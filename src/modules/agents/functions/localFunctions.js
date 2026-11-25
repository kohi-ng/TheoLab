import { getActiveContext } from '../../../core/contextBus.js';

export async function search_vector_kb(query) {
  return { query: String(query), results: [], status: 'index_not_loaded' };
}

export function push_exercise_card(card, target) {
  if (!card || !target) throw new Error('Exercise card and target are required.');
  target.dispatchEvent(new CustomEvent('theolab:exercise', { detail: card }));
}

export function get_active_context() {
  return getActiveContext();
}

export const localFunctions = { search_vector_kb, push_exercise_card, get_active_context };
