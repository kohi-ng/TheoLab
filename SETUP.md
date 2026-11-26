# TheoLab setup

## Run locally

1. Install Node.js 20+.
2. Run `npm install`.
3. Run `npm run dev` and open the local URL printed by Vite.
4. The project starts in `dev_mock`; the sample analytical-chemistry lesson is
   loaded locally and does not require Firebase credentials.

## Configure Firebase Auth and Firestore

1. Create a Firebase project and register a web app.
2. Enable Google as an Authentication provider and configure the authorized
   domains (include `localhost` and your GitHub Pages domain).
3. Create a Firestore database and, if storing files, enable Firebase Storage.
4. Copy `env.example` to `.env.local` (git-ignored): set `VITE_APP_MODE=firebase_auth`,
   set `VITE_OWNER_EMAIL` to your verified Google account, and fill in
   `VITE_FIREBASE_*` from Firebase project settings.
5. Replace `YOUR_EMAIL@gmail.com` in `firestore.rules` and `storage.rules` with
   the same account. Deploy the rules using the Firebase console or Firebase
   CLI. Do not deploy the example rules unchanged.
6. For GitHub Pages CI, add the same `VITE_*` values as repository **Secrets**
   in GitHub (Settings → Secrets and variables → Actions) so your email and
   project ids stay out of Git history.
7. Firebase web configuration identifies a project; it is not an authorization
   secret. Rules and the owner email check enforce access. Never put service
   account credentials in this frontend.

Google sign-in is only available in `firebase_auth`. A signed-in account that
does not match `OWNER_EMAIL` is immediately signed out.

## GitHub Pages deployment

1. Push the project to a repository named `TheoLab` and use the `main` branch.
   The configured Vite base path is `/TheoLab/`; change `vite.config.js` if the
   repository name differs.
2. In repository **Settings → Pages**, select **GitHub Actions** as the build
   and deployment source.
3. Push to `main` or run the Deploy workflow manually. The workflow builds the
   static site and deploys `dist/`.
4. Add the deployed hostname to Firebase Authentication's authorized domains
   before using Google sign-in.

GitHub Pages is public static hosting. Do not commit private lesson content or
expect browser-held API keys/Firebase client settings to be secret.

## Runtime modes and BYOK

- `dev_mock`: default local lesson loaded from `src/mocks/sampleLesson.json`;
  authentication and remote writes are bypassed.
- `firebase_auth`: Google owner sign-in and Firestore persistence. Configure
  Firebase and deploy owner-only rules before switching.

Change the mode in `src/config/runtimeConfig.js`. API keys can be entered in
**Cấu hình** and are stored only in this browser's `localStorage`; they are not
encrypted. Avoid shared devices, clear keys when no longer needed, and do not
commit them. The Agent Loop currently supports direct browser requests to
OpenAI, Anthropic, and Google AI; provider CORS policies, quotas, and direct
browser key exposure apply. Only send prompts/context you agree to disclose.
