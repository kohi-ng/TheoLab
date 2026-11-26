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

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
let driveAccessToken = null;
let driveTokenExpiresAt = 0;

function storeCredentialToken(authModule, result) {
  const credential = authModule.GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    driveAccessToken = credential.accessToken;
    // Google OAuth access tokens typically live 3600s; refresh proactively after 50 min.
    driveTokenExpiresAt = Date.now() + 50 * 60 * 1000;
  }
  return driveAccessToken;
}

export async function signInWithGoogle() {
  const { auth, authModule } = await getFirebaseServices();
  const provider = new authModule.GoogleAuthProvider();
  provider.addScope(DRIVE_FILE_SCOPE);
  const result = await authModule.signInWithPopup(auth, provider);
  if (result.user.email !== OWNER_EMAIL || !result.user.emailVerified) {
    driveAccessToken = null;
    driveTokenExpiresAt = 0;
    await authModule.signOut(auth);
    throw new Error('Tài khoản không được phép truy cập TheoLab.');
  }
  storeCredentialToken(authModule, result);
  return result.user;
}

export async function requestGoogleDriveToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && driveAccessToken && Date.now() < driveTokenExpiresAt) {
    return driveAccessToken;
  }
  const { auth, authModule } = await getFirebaseServices();
  const provider = new authModule.GoogleAuthProvider();
  provider.addScope(DRIVE_FILE_SCOPE);
  if (OWNER_EMAIL) provider.setCustomParameters({ login_hint: OWNER_EMAIL });
  const result = auth.currentUser
    ? await authModule.reauthenticateWithPopup(auth.currentUser, provider)
    : await authModule.signInWithPopup(auth, provider);
  if (result.user.email !== OWNER_EMAIL || !result.user.emailVerified) {
    driveAccessToken = null;
    driveTokenExpiresAt = 0;
    await authModule.signOut(auth);
    throw new Error('Tài khoản không được phép truy cập TheoLab.');
  }
  const token = storeCredentialToken(authModule, result);
  if (!token) {
    throw new Error('Không lấy được Google Drive access token từ phiên đăng nhập.');
  }
  return token;
}

export async function signOut() {
  driveAccessToken = null;
  driveTokenExpiresAt = 0;
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
