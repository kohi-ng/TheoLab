export const APP_MODE = 'dev_mock';
export const OWNER_EMAIL = 'YOUR_EMAIL@gmail.com';

export const firebaseConfig = {
  apiKey: 'YOUR_FIREBASE_WEB_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId: 'YOUR_FIREBASE_APP_ID',
};

export const isFirebaseConfigured = () =>
  Object.values(firebaseConfig).every(
    (value) => typeof value === 'string' && !value.startsWith('YOUR_'),
  );
