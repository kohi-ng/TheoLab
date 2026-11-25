# TheoLab architecture guide

TheoLab is a Vite application using Vanilla JavaScript ES Modules. Keep the
codebase small, browser-native, and free of React, Vue, and Tailwind.

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
- Lesson documents use a strict envelope (`id`, `schema_version`, `core`,
  `payload`) and may add namespaced `extensions`. Blocks are extensible, but
  the viewer must safely handle unknown types.

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

- **Giai đoạn kế tiếp (với Claude):** Nạp tài liệu học mẫu, sau đó chuẩn hóa
  cấu trúc chương/bài học JSON chi tiết gồm lý thuyết, collapsible chứng minh,
  công thức, bài tập trắc nghiệm/nhập số có `tolerance`, và widget mô phỏng.
- **Giai đoạn mở rộng sau:** Tích hợp Vector Embedding chuyên sâu theo từng
  môn (`index.bin` + `meta.json`) trong Web Worker và cung cấp
  `search_vector_kb` cho Agent. Giữ vector index tách rời khỏi phần vỏ và
  không đưa file nhị phân vào Git.
- Các việc nền tảng tiếp theo gồm xử lý token/lỗi provider, xác nhận rõ ràng
  trước khi chia sẻ nội dung bài học, MCP transport có allowlist, schema
  validation/migrations và kiểm thử auth, persistence, tolerance, extension.
