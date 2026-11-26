# TheoLab architecture guide

TheoLab is a Vite application. Legacy modules are Vanilla JavaScript ES Modules;
new UI is written as **Svelte 5 components (runes) in TypeScript**, and new
domain logic as framework-free TypeScript in `src/domain/`. Svelte compiles to
plain DOM code (no runtime virtual DOM), so the bundle stays small and
browser-native. Do not add React, Vue, or Tailwind. Migrate vanilla modules to
Svelte incrementally (mount components into existing containers) — never as a
big-bang rewrite.

Stack: Vite 8 · Svelte 5 · TypeScript (strict) · Zod 4 · Vitest · Firebase
(Auth, Firestore, Storage) · KaTeX + mhchem. Run `npm test` and `npm run check`
before committing.

## Architecture

- `src/config/runtimeConfig.js` owns `APP_MODE`, `OWNER_EMAIL`, and Firebase
  client configuration. `dev_mock` is the safe default; switch deliberately to
  `firebase_auth` after configuring Firebase.
- `src/core/` is the microkernel. `authGate.js` gates owner access,
  `dataGateway.js` is the only persistence boundary, `contextBus.js` publishes
  active learning context, and `moduleRegistry.js` loads optional modules.
- `src/modules/` contains replaceable feature modules. Add functionality there
  and register its loader from `src/main.js`; do not put feature rendering into
  the core.
- Navigation entries live in `src/config/navigationConfig.js` and are
  registered through `moduleRegistry.js`. The drawer shows at most five
  primary vertical rows; additional primary or extension tabs appear under
  `⋯ Thêm`.
- Lesson documents v1 (`id`, `schema_version` 1.x, `core`, `payload`) are
  legacy. Convert them with `migrateLessonV1()` in
  `src/domain/content/migrations.ts`; do not create new v1 documents.

## Content model v2 (`src/domain/content/`)

- Hierarchy: **Subject ▸ Chapter ▸ Unit ▸ Tab ▸ Block**, stored in Firestore as
  `subjects/{s}/chapters/{c}/units/{u}/tabs/{t}` (path builders in `ids.ts`).
  Shared, reusable collections are top-level: `questions`, `datasets`,
  `concepts`, plus the derived `kb_chunks`.
- `schemas.ts` (Zod 4) is the single source of truth for shapes and TS types.
  Validate every import/save with it (`validation.ts` → `parseImport()`
  accepts a `theolab-bundle` or a single document with `kind`).
- Ids are stable ASCII slugs (`slugify()` folds Vietnamese). Sibling order uses
  fractional `order` values (`orderBetween()`), so drag-and-drop rewrites one
  document only.
- A tab is one document with `format: blocks | markdown | file`. Files live in
  owner-only Storage under `content/{s}/{c}/{u}/…`; never use public URLs for
  private material.
- Questions live in `questions` and are referenced from tabs via
  `question_ref` blocks, so lessons and the exam room share one bank. Tables of
  constants (Ka, αY⁴⁻, logβ, E°) are `datasets`, referenced by `dataset_ref`.
- Unknown block types must be namespaced `x-…`; the viewer renders a safe
  placeholder for them. Firestore forbids nested arrays (tables use
  `rows: [{ cells: [] }]`).
- **Source of truth is Firestore (owner-only), not Git.** Never commit lesson
  content, exam files, or exports. Owner email and Firebase config come from
  `VITE_*` env variables (`.env.local` locally, Actions secrets in CI).

## Vector knowledge base (`src/domain/kb/`)

- Embeddings: Gemini `gemini-embedding-2` (GA), 768 dims, called from the
  browser with the owner's BYOK key. It has no `taskType`; use the prefixes in
  `formatForEmbedding()` (`task: search result | query: …` /
  `title: … | text: …`). Never mix vectors of different models or dimensions.
- Chunking (`chunking.ts`): one block = one chunk, markdown split by headings,
  each chunk has a breadcrumb, `deep_link` and a SHA-256 `content_hash`
  (covers model + dims) for incremental re-embedding.
- Storage: `kb_chunks` docs hold metadata + int8-quantised vector (base64) +
  scale. Firestore KNN is server-SDK only, so retrieval runs client-side in
  `vectorWorker.ts`: exact int8 dense scan + Vietnamese-folded BM25, fused with
  RRF (`hybridSearch.ts`). Cache chunks in IndexedDB and sync by `updated_at`.

## Widget Plug Contract

- `widget_embed` loads a named HTML file from `public/widgets/` using
  `${import.meta.env.BASE_URL}widgets/<file>`. It must render in an iframe with
  `sandbox="allow-scripts"` only; never grant `allow-same-origin`. The widget
  starts after `THEOLAB_INIT` and can report state with
  `THEOLAB_WIDGET_STATE`. The host accepts messages only from that iframe's
  `contentWindow`, then publishes the data through `contextBus`.
- `widget_native` names a registered `widget:<widget_id>` module. Native widget
  modules export `mount(container, props, { contextBus })` and return an
  `unmount()` function. Register loaders through `moduleRegistry`; the lesson
  viewer owns cleanup when a lesson or preview is replaced.
- Treat all iframe messages and widget state as untrusted data. Do not expose
  credentials, parent DOM access, or privileged capabilities to embedded
  widgets.

## AI Sessions, Context Picker, and Chat

- Full-screen AI conversations are independent of the quick Agent Drawer.
  Persist session metadata, messages, model, and preferences through
  `dataGateway.js`; local mock sessions use `localStorage`, while Firebase
  sessions belong in the owner-protected `chat_sessions` collection.
- `ChatComposer` and `MessageRenderer` are shared by both chat surfaces. Keep
  input content rendered as text, and keep model/tuning and context selection
  preferences scoped to the current session.
- Library attachments are explicit, stored with the selected AI session, and
  surfaced in the shared Context Bar. Keep their provider payload sanitized
  and bounded; do not attach document contents implicitly.

## Library Viewer

- `src/modules/library/libraryCatalog.js` owns the catalog and its categories:
  learning documents, Formula Hub, and interactive widgets.
- Selecting an item opens it on the Main Canvas. PDFs use `public/docs/`,
  Google Drive/Docs links use preview URLs, and Markdown is parsed into DOM
  nodes with text content and KaTeX rather than inserted as HTML. JSON is shown
  with `textContent`; widget entries reuse the sandboxed Widget Plug contract.
- External resources are untrusted. Validate supported Google hosts, keep
  local asset paths constrained to `public/docs/`, and do not render imported
  HTML or Markdown as executable markup.
- The Context Bar can opt in to active lesson/block/widget state and explicit
  lesson or Formula Hub attachments. Only pass sanitized lesson fields to an
  Agent provider, and only send context when the user has enabled or selected
  it. BYOK keys remain browser-local and are never included in session records.

## UI rules

Use the tokens in `src/styles/tokens.css`. The interface is borderless: do not
add outlines or borders to imitate card dividers. Establish hierarchy with
tonal surfaces, whitespace, soft corners, and very subtle shadows for floating
controls and popovers only. Keep the responsive drawer and mobile chat sheet
usable by keyboard and touch. Inputs, selectors, and buttons may set
`border: 0`; never add visible border lines to cards, panels, or controls.

## Security: shell versus data

- Treat lesson text, MCP responses, model output, and imported files as
  untrusted data. Render user content with `textContent` or escaped templates;
  never execute it as HTML or code.
- Firebase rules are the actual server-side access control. Replace the
  placeholder owner in both rules files and `runtimeConfig.js` consistently,
  verify the Firebase email, then deploy the rules.
- Never put private lesson data, credentials, or API keys in the GitHub Pages
  bundle. BYOK keys are stored in browser `localStorage` for this single-user
  prototype; this is convenience storage, not encrypted/secure storage. Clear
  it on shared devices. Do not log, transmit, or commit keys.
- Shell commands and build scripts must remain explicit and reviewable. Do not
  execute commands or code sourced from lessons, model responses, MCP servers,
  or imported documents.
- Keep `.env*`, `*.bin`, `content-private/`, `node_modules/`, and `dist/`
  ignored. The published GitHub Pages site is a public static client; do not
  assume Firebase configuration or browser-held API keys are secret.

## Roadmap mở rộng

- **Giai đoạn 0 (xong):** Toolchain Vite 8 + Svelte 5 + TypeScript + Zod 4 +
  Vitest; Content model v2 (`src/domain/content/`); Vector KB core
  (`src/domain/kb/`, `vectorWorker.ts`); env-based `runtimeConfig.js` và
  `firestore.rules` theo từng collection (owner-only).
- **Giai đoạn 1 (đang triển khai):** `contentRepository.ts` (Firestore +
  `dev_mock`), cây **Môn ▸ Chương ▸ Bài ▸ Tab** bằng Svelte 5 có nút `+` ở mọi
  cấp, tab tài liệu/markdown/blocks, nạp/xuất JSON kèm Zod validation, và deep
  link `#/subject/chapter/unit/tab#block`.
- **Giai đoạn 2:** Trình biên dịch Markdown-directive ↔ blocks, import DOCX/đề
  thi (human-in-the-loop) vào `questions` + `datasets`.
- **Giai đoạn 3:** Ngân hàng câu hỏi (`question_ref`), bảng phụ lục dùng chung
  (`dataset_ref`), Phòng thi theo ma trận CLO.
- **Giai đoạn 4:** Pipeline đồng bộ `kb_chunks` (IndexedDB + Firestore),
  `search_kb` + trích dẫn bấm được cho Agent, Command Palette `Ctrl+K`.
- **Giai đoạn 5:** Đồ thị khái niệm (`concepts`), bài liên quan, tiến độ học
  tập và ôn tập ngắt quãng.
