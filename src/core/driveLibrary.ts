/**
 * Owner-only Google Drive Library catalog stored in Firestore (`settings/library_drive`).
 * Keeps all heavy PDFs/slides/docs in the owner's personal Google Drive instead of
 * Firebase Storage; Firestore only stores the validated Drive URLs and titles.
 */
import { APP_MODE, firebaseConfig, isFirebaseConfigured } from '../config/runtimeConfig.js';
import { isAllowedDriveUrl } from './secretsVault';
import { toFirestoreData } from './firestoreData';
import { slugify } from '../domain/content/ids';

export interface DriveLibraryItem {
  id: string;
  category: 'documents';
  title: string;
  sourceLabel: string;
  type: 'google';
  url: string;
  note?: string;
  contextText: string;
  userAdded: true;
  created_at: string;
}

const LOCAL_KEY = 'theolab:library-drive';

async function getDb() {
  if (APP_MODE !== 'firebase_auth' || !isFirebaseConfigured()) {
    throw new Error('Firestore chưa sẵn sàng.');
  }
  const [{ initializeApp, getApps }, { getFirestore }] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
  ]);
  return getFirestore(getApps()[0] ?? initializeApp(firebaseConfig));
}

export async function listDriveLibraryItems(): Promise<DriveLibraryItem[]> {
  if (APP_MODE === 'dev_mock') {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as DriveLibraryItem[]) : [];
  }
  try {
    const db = await getDb();
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'settings', 'library_drive'));
    const data = snap.exists() ? (snap.data() as { items?: DriveLibraryItem[] }) : null;
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

async function persistItems(items: DriveLibraryItem[]): Promise<void> {
  if (APP_MODE === 'dev_mock') {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
    return;
  }
  const db = await getDb();
  const { doc, setDoc } = await import('firebase/firestore');
  await setDoc(doc(db, 'settings', 'library_drive'), toFirestoreData({
    items,
    updated_at: new Date().toISOString(),
  }));
}

export async function addDriveLibraryItem(input: { title: string; url: string; note?: string }): Promise<DriveLibraryItem> {
  const title = input.title.trim();
  const url = input.url.trim();
  if (!title) throw new Error('Nhập tên tài liệu.');
  if (!isAllowedDriveUrl(url)) {
    throw new Error('Chỉ chấp nhận liên kết https://drive.google.com hoặc https://docs.google.com.');
  }
  const items = await listDriveLibraryItems();
  const item: DriveLibraryItem = {
    id: `drive-${slugify(title)}-${Date.now().toString(36)}`,
    category: 'documents',
    title,
    sourceLabel: url.includes('/spreadsheets/')
      ? 'Google Sheets'
      : url.includes('/presentation/')
        ? 'Google Slides'
        : url.includes('docs.google.com')
          ? 'Google Docs'
          : 'Google Drive',
    type: 'google',
    url,
    note: input.note?.trim() || undefined,
    contextText: `${title} (Google Drive): ${url}${input.note ? `\n${input.note.trim()}` : ''}`,
    userAdded: true,
    created_at: new Date().toISOString(),
  };
  await persistItems([item, ...items]);
  return item;
}

export async function removeDriveLibraryItem(id: string): Promise<void> {
  const items = await listDriveLibraryItems();
  await persistItems(items.filter((item) => item.id !== id));
}
