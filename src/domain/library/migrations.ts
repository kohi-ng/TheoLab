/**
 * Migrations and adapters bridging legacy `settings/library_drive`,
 * `theolab:library-drive`, and built-in `libraryCatalog.js` entries into Library v2.
 */
import { slugify } from '../content/ids';
import {
  LegacyDriveLibraryItemSchema,
  LibraryItemSchema,
  type LibraryItem,
  type LibraryItemKind,
  type LibraryItemView,
} from './schemas';
import { DRIVE_FOLDER_MIME, getKindLabel } from './query';

export function extractDriveFileId(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== 'https:') return undefined;
    if (!['drive.google.com', 'docs.google.com'].includes(url.hostname)) return undefined;
    const match = url.pathname.match(
      /\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d|folders)\/([^/?#]+)/,
    );
    const id = match?.[1] ?? url.searchParams.get('id') ?? undefined;
    if (!id || id.startsWith('REPLACE_')) return undefined;
    return id;
  } catch {
    return undefined;
  }
}

export function detectKindFromDriveUrl(rawUrl: string, mimeType?: string): LibraryItemKind {
  if (mimeType) {
    if (mimeType === 'application/vnd.google-apps.document') return 'google-doc';
    if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'google-sheet';
    if (mimeType === 'application/vnd.google-apps.presentation') return 'google-slide';
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType === 'text/markdown' || mimeType === 'text/x-markdown') return 'markdown';
    if (mimeType === 'application/json') return 'json';
    return 'drive-file';
  }
  const lower = rawUrl.toLowerCase();
  if (lower.includes('/document/')) return 'google-doc';
  if (lower.includes('/spreadsheets/')) return 'google-sheet';
  if (lower.includes('/presentation/')) return 'google-slide';
  return 'drive-file';
}

export function detectMimeTypeFromDriveUrl(rawUrl: string): string | undefined {
  const lower = rawUrl.toLowerCase();
  if (lower.includes('/folders/')) return DRIVE_FOLDER_MIME;
  if (lower.includes('/document/')) return 'application/vnd.google-apps.document';
  if (lower.includes('/spreadsheets/')) return 'application/vnd.google-apps.spreadsheet';
  if (lower.includes('/presentation/')) return 'application/vnd.google-apps.presentation';
  return undefined;
}

/**
 * Converts a legacy item from `theolab:library-drive` or Firestore `settings/library_drive`
 * into a validated Library v2 `LibraryItem`.
 */
export function migrateLegacyDriveItem(raw: unknown, order = 1000): LibraryItem | null {
  const parsed = LegacyDriveLibraryItemSchema.safeParse(raw);
  if (!parsed.success) return null;
  const legacy = parsed.data;
  const now = new Date().toISOString();
  const createdAt = legacy.created_at || now;
  const mimeType = detectMimeTypeFromDriveUrl(legacy.url);
  const kind = detectKindFromDriveUrl(legacy.url, mimeType);
  const driveFileId = extractDriveFileId(legacy.url);

  return LibraryItemSchema.parse({
    id: legacy.id,
    title: legacy.title,
    kind,
    source: 'drive',
    url: legacy.url,
    driveFileId,
    mimeType,
    folderId: null,
    tags: [],
    description: legacy.note?.trim() || undefined,
    createdAt,
    updatedAt: createdAt,
    order,
  });
}

export function migrateLegacyDriveItems(rawList: unknown): LibraryItem[] {
  if (!Array.isArray(rawList)) return [];
  const out: LibraryItem[] = [];
  const seen = new Set<string>();
  rawList.forEach((entry, index) => {
    const item = migrateLegacyDriveItem(entry, (index + 1) * 1000);
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  });
  return out;
}

export interface BuiltinCatalogDoc {
  id: string;
  category: string;
  title: string;
  sourceLabel?: string;
  type: string;
  file?: string;
  url?: string;
  note?: string;
  contextText?: string;
  content?: unknown;
  widget?: LibraryItemView['widget'];
}

const BUILTIN_CREATED_AT = '2026-01-01T00:00:00.000Z';

function mapBuiltinKind(doc: BuiltinCatalogDoc): LibraryItemKind {
  if (doc.type === 'google') return detectKindFromDriveUrl(doc.url ?? '');
  if (doc.type === 'markdown' || doc.type === 'pdf' || doc.type === 'json' || doc.type === 'formula' || doc.type === 'widget') {
    return doc.type;
  }
  return 'markdown';
}

/**
 * Maps read-only built-in documents from `libraryCatalog.js` into `LibraryItemView` objects.
 */
export function buildBuiltinLibraryItems(docs: readonly BuiltinCatalogDoc[]): LibraryItemView[] {
  return docs.map((doc, index) => {
    const kind = mapBuiltinKind(doc);
    const base = LibraryItemSchema.parse({
      id: doc.id,
      title: doc.title,
      kind,
      source: 'builtin',
      url: doc.url,
      driveFileId: extractDriveFileId(doc.url),
      file: doc.file,
      mimeType: doc.url ? detectMimeTypeFromDriveUrl(doc.url) : undefined,
      folderId: null,
      tags: doc.category === 'formulas' ? ['công thức'] : doc.category === 'widgets' ? ['mô phỏng'] : [],
      description: doc.note,
      createdAt: BUILTIN_CREATED_AT,
      updatedAt: BUILTIN_CREATED_AT,
      order: (index + 1) * 1000,
    });
    return {
      ...base,
      readonly: true,
      type: doc.type,
      sourceLabel: doc.sourceLabel ?? getKindLabel(kind),
      note: doc.note,
      contextText: doc.contextText,
      content: doc.content,
      widget: doc.widget,
    };
  });
}

/**
 * Produces a legacy-compatible view (with `type`, `sourceLabel`, `contextText`)
 * so `libraryViewer.js` and `buildLibraryDockSpec` work seamlessly with Library v2 items.
 */
export function enrichLibraryItemView(item: LibraryItemView): LibraryItemView {
  const isGoogleBacked =
    item.source === 'drive' ||
    item.kind === 'google-doc' ||
    item.kind === 'google-sheet' ||
    item.kind === 'google-slide' ||
    item.kind === 'drive-file';

  const compatType = item.type ?? (isGoogleBacked && item.url ? 'google' : item.kind);
  const sourceLabel = item.sourceLabel ?? getKindLabel(item.kind, item.mimeType);
  const contextText =
    item.contextText ??
    (item.url
      ? `${item.title} (${sourceLabel}): ${item.url}${item.description ? `\n${item.description}` : ''}`
      : `${item.title} (${sourceLabel})${item.description ? `\n${item.description}` : ''}`);

  return {
    ...item,
    type: compatType,
    sourceLabel,
    note: item.note ?? item.description,
    contextText,
  };
}

export function buildNewItemId(prefix: string, title: string): string {
  return `${prefix}-${slugify(title, 48)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}
