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

## Configure Google Picker API & Google Drive (Library Import)

To pick files and folders directly from Google Drive inside **Thư viện** (using the narrow `drive.file` OAuth scope):

1. Open the Google Cloud Console for the same project used by your Firebase app.
2. Go to **APIs & Services → Library** and enable both:
   - **Google Picker API**
   - **Google Drive API** (needed for creating Google Docs/Sheets and expanding picked Drive folders)
3. Go to **APIs & Services → Credentials → Create credentials → API key**:
   - Under **Application restrictions**, select **Websites (HTTP referrers)** and allow only your origins:
     - `http://localhost:*/*` (local dev)
     - `https://<your-username>.github.io/TheoLab/*` (GitHub Pages)
   - Under **API restrictions**, restrict the key to **Google Picker API** only.
4. Find your **Project Number** (numeric) in **Project Settings** — this is your Google Picker App ID.
5. Add both variables to `.env.local` (and GitHub Actions **Secrets** for CI deployment):
   - `VITE_GOOGLE_PICKER_API_KEY=<your-referrer-restricted-browser-api-key>`
   - `VITE_GOOGLE_PICKER_APP_ID=<your-google-cloud-project-number>`
6. Deploy owner-only Firestore Rules covering `library_items/{itemId}` and `library_folders/{folderId}`.

Picker is lazy-loaded only when you click **Chọn từ Google Drive**. In `dev_mock` mode (or if Picker env vars are omitted), you can still add Drive documents manually via **Dán liên kết**.

## Runtime modes and BYOK

- `dev_mock`: default local lesson loaded from `src/mocks/sampleLesson.json`;
  authentication and remote writes are bypassed.
- `firebase_auth`: Google owner sign-in and Firestore persistence. Configure
  Firebase and deploy owner-only rules before switching.

Change the mode via `VITE_APP_MODE` in `.env.local` (read by `src/config/runtimeConfig.js`).
AI providers, models, defaults, profiles, and BYOK API keys are managed in **Cấu hình → Cấu hình AI**.
API keys are stored in this browser's `localStorage` (not encrypted); the unified Google AI Studio
key is shared between Google AI Studio chat/Theon and Vector Embedding (`gemini-embedding-2`) and
can optionally sync to the owner-only Firestore Vault (`settings/secrets`) in `firebase_auth`.
Avoid shared devices, clear keys when no longer needed, and do not commit them. The Agent Loop
supports direct browser requests to Vertex AI (Firebase AI Logic), Google AI Studio, Anthropic,
OpenAI, OpenRouter, and custom OpenAI-compatible endpoints; provider CORS policies, quotas, and
direct browser key exposure apply. Only send prompts/context you agree to disclose.
