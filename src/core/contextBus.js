const state = {
  activeTab: 'Bài học',
  lessonId: null,
  lessonTitle: null,
  selectedBlockId: null,
  lastExerciseResult: null,
  widgetState: null,
  libraryContext: null,
  activeDockTab: null,
};
const subscribers = new Set();

export function getActiveContext() {
  return structuredClone(state);
}

export function updateContext(patch) {
  Object.assign(state, patch);
  const snapshot = getActiveContext();
  subscribers.forEach((subscriber) => subscriber(snapshot));
  return snapshot;
}

export function subscribeContext(subscriber) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}
