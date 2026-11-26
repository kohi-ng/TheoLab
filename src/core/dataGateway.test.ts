import { describe, expect, it, vi } from 'vitest';

const setDoc = vi.fn();
vi.mock('../config/runtimeConfig.js', () => ({
  APP_MODE: 'firebase_auth',
  firebaseConfig: {},
  isFirebaseConfigured: () => true,
}));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}), getApps: () => [] }));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}),
  doc: () => ({}),
  collection: () => ({}),
  getDoc: async () => ({ exists: () => false }),
  getDocs: async () => ({ docs: [] }),
  setDoc,
}));

const { loadLesson, listLessons, saveChatSession } = await import('./dataGateway.js');

describe('dataGateway on Firestore', () => {
  it('falls back to the sample lesson on an empty database', async () => {
    const lesson = await loadLesson();
    expect(lesson.id).toBeTruthy();
    expect(await listLessons()).toHaveLength(1);
    await expect(loadLesson('missing')).rejects.toThrow();
  });

  it('never writes undefined fields', async () => {
    await saveChatSession({ id: 's1', preferences: { activeTitle: undefined } });
    expect(setDoc.mock.calls[0]?.[1].preferences).toStrictEqual({});
  });
});
