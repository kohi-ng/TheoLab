/**
 * Runtime configuration comes from Vite env variables so that the owner email and
 * Firebase project are never hard-coded in Git. Locally use `.env.local` (git-ignored);
 * in CI use GitHub Actions secrets (see SETUP.md). Firebase web config identifies the
 * project, it is not a secret — Firestore/Storage rules enforce access.
 */
const env = import.meta.env ?? {};

export const APP_MODE = env.VITE_APP_MODE === 'firebase_auth' ? 'firebase_auth' : 'dev_mock';
export const OWNER_EMAIL = env.VITE_OWNER_EMAIL || 'YOUR_EMAIL@gmail.com';

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'YOUR_FIREBASE_WEB_API_KEY',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'YOUR_PROJECT_ID',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || 'YOUR_MESSAGING_SENDER_ID',
  appId: env.VITE_FIREBASE_APP_ID || 'YOUR_FIREBASE_APP_ID',
};

export const isFirebaseConfigured = () =>
  !OWNER_EMAIL.startsWith('YOUR_')
  && Object.values(firebaseConfig).every(
    (value) => typeof value === 'string' && !value.startsWith('YOUR_'),
  );

export const googlePickerConfig = {
  apiKey: env.VITE_GOOGLE_PICKER_API_KEY || '',
  appId: env.VITE_GOOGLE_PICKER_APP_ID || '',
};

export const isGooglePickerConfigured = () =>
  Boolean(googlePickerConfig.apiKey.trim() && googlePickerConfig.appId.trim());
