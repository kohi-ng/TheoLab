/**
 * Owner-only Secrets & Preferences Vault stored in Firestore (`settings/secrets`).
 *
 * Security model:
 * - Never committed to Git, never baked into `VITE_*` build env.
 * - Readable/writable ONLY when signed in with the verified owner Gmail (enforced by
 *   Firestore Rules). Cached in memory only for the active session and cleared on sign-out.
 */
import { APP_MODE, firebaseConfig, isFirebaseConfigured } from '../config/runtimeConfig.js';
import { toFirestoreData } from './firestoreData';

export interface OwnerVaultData {
  vertexApiKey?: string;
  geminiApiKey?: string;
  driveFolderUrl?: string;
  vertexLocation?: string;
  calendarEmbedUrl?: string;
  jupyterLiteUrl?: string;
  ketcherUrl?: string;
  desmosUrl?: string;
}

const LOCAL_VAULT_KEY = 'theolab:dev-vault';
let memoryCache: OwnerVaultData | null = null;

async function getDb() {
  if (APP_MODE !== 'firebase_auth' || !isFirebaseConfigured()) {
    throw new Error('Firestore chưa được cấu hình cho Vault.');
  }
  const [{ initializeApp, getApps }, { getFirestore }] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
  ]);
  return getFirestore(getApps()[0] ?? initializeApp(firebaseConfig));
}

export function clearVaultCache(): void {
  memoryCache = null;
}

export function getCachedVault(): OwnerVaultData {
  return memoryCache ? { ...memoryCache } : {};
}

export async function loadOwnerVault(): Promise<OwnerVaultData> {
  if (APP_MODE === 'dev_mock') {
    const raw = localStorage.getItem(LOCAL_VAULT_KEY);
    memoryCache = raw ? (JSON.parse(raw) as OwnerVaultData) : {};
    return { ...memoryCache };
  }
  const db = await getDb();
  const { doc, getDoc } = await import('firebase/firestore');
  const snap = await getDoc(doc(db, 'settings', 'secrets'));
  memoryCache = snap.exists() ? (snap.data() as OwnerVaultData) : {};
  return { ...memoryCache };
}

export async function saveOwnerVault(patch: Partial<OwnerVaultData>): Promise<OwnerVaultData> {
  const next: OwnerVaultData = {
    ...(memoryCache ?? {}),
    ...patch,
  };
  // Strip empty strings so deleted keys are not persisted.
  for (const key of Object.keys(next) as Array<keyof OwnerVaultData>) {
    if (typeof next[key] === 'string') {
      const trimmed = next[key]!.trim();
      if (trimmed) next[key] = trimmed;
      else delete next[key];
    }
  }
  if (APP_MODE === 'dev_mock') {
    localStorage.setItem(LOCAL_VAULT_KEY, JSON.stringify(next));
    memoryCache = next;
    return { ...next };
  }
  const db = await getDb();
  const { doc, setDoc } = await import('firebase/firestore');
  await setDoc(doc(db, 'settings', 'secrets'), toFirestoreData({ ...next, updated_at: new Date().toISOString() }));
  memoryCache = next;
  return { ...next };
}

export function isAllowedDriveUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(parsed.hostname);
  } catch {
    return false;
  }
}
