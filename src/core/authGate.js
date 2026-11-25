import { APP_MODE, OWNER_EMAIL, firebaseConfig, isFirebaseConfigured } from '../config/runtimeConfig.js';

let firebaseServices;

async function getFirebaseServices() {
  if (APP_MODE !== 'firebase_auth') {
    throw new Error('Firebase Auth is unavailable in dev_mock mode.');
  }
  if (!isFirebaseConfigured()) {
    throw new Error('Configure Firebase in src/config/runtimeConfig.js first.');
  }
  if (!firebaseServices) {
    const [{ initializeApp, getApps }, authModule] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
    ]);
    const app = getApps()[0] ?? initializeApp(firebaseConfig);
    firebaseServices = { auth: authModule.getAuth(app), authModule };
  }
  return firebaseServices;
}

export async function signInWithGoogle() {
  const { auth, authModule } = await getFirebaseServices();
  const provider = new authModule.GoogleAuthProvider();
  const result = await authModule.signInWithPopup(auth, provider);
  if (result.user.email !== OWNER_EMAIL || !result.user.emailVerified) {
    await authModule.signOut(auth);
    throw new Error('Tài khoản không được phép truy cập TheoLab.');
  }
  return result.user;
}

export async function signOut() {
  const { auth, authModule } = await getFirebaseServices();
  await authModule.signOut(auth);
}

export async function getAuthState(onChange) {
  if (APP_MODE === 'dev_mock') {
    onChange({ mode: APP_MODE, user: null, authorized: true });
    return () => {};
  }
  const { auth, authModule } = await getFirebaseServices();
  return authModule.onAuthStateChanged(auth, async (user) => {
    if (user && (user.email !== OWNER_EMAIL || !user.emailVerified)) {
      await authModule.signOut(auth);
      onChange({ mode: APP_MODE, user: null, authorized: false });
      return;
    }
    onChange({
      mode: APP_MODE,
      user,
      authorized: Boolean(user && user.email === OWNER_EMAIL && user.emailVerified),
    });
  });
}
