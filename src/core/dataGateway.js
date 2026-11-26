import sampleLesson from '../mocks/sampleLesson.json';
import { APP_MODE, firebaseConfig, isFirebaseConfigured } from '../config/runtimeConfig.js';
import { toFirestoreData } from './firestoreData';

const KEY_STORAGE_PREFIX = 'theolab:byok:';
let firestore;

async function getFirestore() {
  if (APP_MODE !== 'firebase_auth' || !isFirebaseConfigured()) {
    throw new Error('Firestore is not configured for this runtime.');
  }
  if (!firestore) {
    const [{ initializeApp, getApps }, { getFirestore: createFirestore }] = await Promise.all([
      import('firebase/app'),
      import('firebase/firestore'),
    ]);
    firestore = createFirestore(getApps()[0] ?? initializeApp(firebaseConfig));
  }
  return firestore;
}

export async function loadLesson(lessonId = sampleLesson.id) {
  if (APP_MODE === 'dev_mock') {
    const saved = localStorage.getItem(`theolab:lesson:${lessonId}`);
    return saved ? JSON.parse(saved) : structuredClone(sampleLesson);
  }
  const db = await getFirestore();
  const { doc, getDoc } = await import('firebase/firestore');
  const snapshot = await getDoc(doc(db, 'lessons', lessonId));
  // A fresh database has no seed document yet; start from the bundled sample.
  if (!snapshot.exists() && lessonId === sampleLesson.id) return structuredClone(sampleLesson);
  if (!snapshot.exists()) throw new Error(`Không tìm thấy bài học "${lessonId}".`);
  return { id: snapshot.id, ...snapshot.data() };
}

export async function saveLesson(lesson) {
  if (!lesson?.id) throw new Error('Bài học phải có id trước khi lưu.');
  if (APP_MODE === 'dev_mock') {
    localStorage.setItem(`theolab:lesson:${lesson.id}`, JSON.stringify(lesson));
    return lesson;
  }
  const db = await getFirestore();
  const { doc, setDoc } = await import('firebase/firestore');
  await setDoc(doc(db, 'lessons', lesson.id), toFirestoreData(lesson));
  return lesson;
}

export async function listLessons() {
  if (APP_MODE === 'dev_mock') {
    const saved = Object.keys(localStorage)
      .filter((key) => key.startsWith('theolab:lesson:'))
      .map((key) => JSON.parse(localStorage.getItem(key)));
    const lessons = [structuredClone(sampleLesson), ...saved];
    return [...new Map(lessons.map((lesson) => [lesson.id, lesson])).values()];
  }
  const db = await getFirestore();
  const { collection, getDocs } = await import('firebase/firestore');
  const snapshot = await getDocs(collection(db, 'lessons'));
  if (!snapshot.docs.length) return [structuredClone(sampleLesson)];
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

function chatSessionStorageKey(id) {
  return `theolab:chat-session:${id}`;
}

export async function listChatSessions() {
  if (APP_MODE === 'dev_mock') {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith('theolab:chat-session:'))
      .map((key) => JSON.parse(localStorage.getItem(key)))
      .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
  }
  const db = await getFirestore();
  const { collection, getDocs, orderBy, query } = await import('firebase/firestore');
  const snapshot = await getDocs(query(collection(db, 'chat_sessions'), orderBy('updatedAt', 'desc')));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

export async function saveChatSession(session) {
  if (!session?.id) throw new Error('Chat session must have an id before saving.');
  const record = { ...session, updatedAt: new Date().toISOString() };
  if (APP_MODE === 'dev_mock') {
    localStorage.setItem(chatSessionStorageKey(record.id), JSON.stringify(record));
    return record;
  }
  const db = await getFirestore();
  const { doc, setDoc } = await import('firebase/firestore');
  await setDoc(doc(db, 'chat_sessions', record.id), toFirestoreData(record));
  return record;
}

export async function deleteChatSession(id) {
  if (!id) throw new Error('Chat session id is required.');
  if (APP_MODE === 'dev_mock') {
    localStorage.removeItem(chatSessionStorageKey(id));
    return;
  }
  const db = await getFirestore();
  const { deleteDoc, doc } = await import('firebase/firestore');
  await deleteDoc(doc(db, 'chat_sessions', id));
}

export function getApiKey(provider) {
  return localStorage.getItem(`${KEY_STORAGE_PREFIX}${provider}`) ?? '';
}

export function saveApiKey(provider, key) {
  if (!provider) throw new Error('Provider name is required.');
  if (key) localStorage.setItem(`${KEY_STORAGE_PREFIX}${provider}`, key.trim());
  else localStorage.removeItem(`${KEY_STORAGE_PREFIX}${provider}`);
}

export function getLocalSetting(name, fallback = '') {
  return localStorage.getItem(`theolab:setting:${name}`) ?? fallback;
}

export function saveLocalSetting(name, value) {
  localStorage.setItem(`theolab:setting:${name}`, String(value));
}
