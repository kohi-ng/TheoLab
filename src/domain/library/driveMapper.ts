/**
 * Pure domain mappers for Google Picker selections and Google Drive imports.
 * Handles mimeType → LibraryItemKind mapping, Drive URL validation,
 * Picker doc → editable draft conversion, and batch rename/confirm preparation.
 */
import type { LibraryItemKind } from './schemas';
import { DRIVE_FOLDER_MIME, normalizeTags } from './query';
import { detectKindFromDriveUrl, extractDriveFileId } from './migrations';

export interface GooglePickerDocument {
  id: string;
  name?: string;
  mimeType?: string;
  url?: string;
  embedUrl?: string;
  iconUrl?: string;
}

export interface DriveImportDraft {
  draftId: string;
  selected: boolean;
  driveFileId: string;
  title: string;
  originalName: string;
  mimeType: string;
  kind: LibraryItemKind;
  url: string;
  isFolder: boolean;
  /** When `isFolder` is true: 'link' saves folder link, 'expand' expands children files. */
  folderAction?: 'link' | 'expand';
  folderId: string | null;
  tags: string[];
  description: string;
  fromFolderId?: string;
}

export interface PreparedDriveLibraryInput {
  title: string;
  kind: LibraryItemKind;
  source: 'drive';
  url: string;
  driveFileId?: string;
  mimeType?: string;
  folderId: string | null;
  tags: string[];
  description?: string;
}

const ALLOWED_DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com']);

export function validateDriveUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return false;
    if (!ALLOWED_DRIVE_HOSTS.has(parsed.hostname)) return false;
    const id = extractDriveFileId(rawUrl);
    if (rawUrl.includes('REPLACE_')) return false;
    // Allow valid file/doc/sheet/slide/folder URLs or general Drive URLs on whitelisted hosts
    return Boolean(id || parsed.pathname.includes('/folders/') || parsed.pathname.includes('/file/'));
  } catch {
    return false;
  }
}

export function mimeTypeToLibraryKind(mimeType?: string, rawUrl?: string): LibraryItemKind {
  const clean = (mimeType ?? '').trim().toLowerCase();
  if (clean === 'application/vnd.google-apps.document') return 'google-doc';
  if (clean === 'application/vnd.google-apps.spreadsheet') return 'google-sheet';
  if (clean === 'application/vnd.google-apps.presentation') return 'google-slide';
  if (clean === 'application/pdf') return 'pdf';
  if (clean === 'text/markdown' || clean === 'text/x-markdown') return 'markdown';
  if (clean === 'application/json') return 'json';
  if (clean === DRIVE_FOLDER_MIME) return 'drive-file';
  if (rawUrl) return detectKindFromDriveUrl(rawUrl);
  return 'drive-file';
}

export function describeDriveMimeType(mimeType?: string): string {
  const clean = (mimeType ?? '').trim().toLowerCase();
  if (clean === DRIVE_FOLDER_MIME) return 'Thư mục Drive';
  if (clean === 'application/vnd.google-apps.document') return 'Google Docs';
  if (clean === 'application/vnd.google-apps.spreadsheet') return 'Google Sheets';
  if (clean === 'application/vnd.google-apps.presentation') return 'Google Slides';
  if (clean === 'application/pdf') return 'PDF (Drive)';
  if (clean.startsWith('image/')) return 'Hình ảnh (Drive)';
  if (clean.startsWith('video/')) return 'Video (Drive)';
  if (clean.startsWith('audio/')) return 'Âm thanh (Drive)';
  if (clean === 'text/markdown' || clean === 'text/x-markdown') return 'Markdown (Drive)';
  if (clean === 'application/json') return 'JSON (Drive)';
  return 'Tệp Google Drive';
}

export function buildDriveCanonicalUrl(
  driveFileId: string,
  mimeType?: string,
  fallbackUrl?: string,
): string {
  const encoded = encodeURIComponent(driveFileId.trim());
  const cleanMime = (mimeType ?? '').trim().toLowerCase();
  if (cleanMime === DRIVE_FOLDER_MIME) {
    return `https://drive.google.com/drive/folders/${encoded}`;
  }
  if (cleanMime === 'application/vnd.google-apps.document') {
    return `https://docs.google.com/document/d/${encoded}/edit`;
  }
  if (cleanMime === 'application/vnd.google-apps.spreadsheet') {
    return `https://docs.google.com/spreadsheets/d/${encoded}/edit`;
  }
  if (cleanMime === 'application/vnd.google-apps.presentation') {
    return `https://docs.google.com/presentation/d/${encoded}/edit`;
  }
  if (fallbackUrl && validateDriveUrl(fallbackUrl)) {
    return fallbackUrl.trim();
  }
  return `https://drive.google.com/file/d/${encoded}/view`;
}

export function mapPickerDocToDraft(
  doc: GooglePickerDocument,
  defaults: { folderId?: string | null; tags?: string[]; fromFolderId?: string } = {},
): DriveImportDraft {
  const driveFileId = doc.id.trim();
  if (!driveFileId) {
    throw new Error('Mục được chọn từ Google Drive thiếu mã tệp (id).');
  }
  const mimeType = (doc.mimeType ?? '').trim();
  const isFolder = mimeType === DRIVE_FOLDER_MIME;
  const url = buildDriveCanonicalUrl(driveFileId, mimeType, doc.url);
  if (!validateDriveUrl(url)) {
    throw new Error(`Liên kết Drive không hợp lệ cho tệp "${doc.name ?? driveFileId}".`);
  }
  const kind = mimeTypeToLibraryKind(mimeType, url);
  const originalName = (doc.name ?? '').trim() || `Tài liệu Drive (${driveFileId.slice(0, 8)})`;

  return {
    draftId: `draft-${driveFileId}-${Math.random().toString(36).slice(2, 6)}`,
    selected: true,
    driveFileId,
    title: originalName,
    originalName,
    mimeType: mimeType || 'application/octet-stream',
    kind,
    url,
    isFolder,
    folderAction: isFolder ? 'link' : undefined,
    folderId: defaults.folderId ?? null,
    tags: normalizeTags(defaults.tags ?? []),
    description: '',
    fromFolderId: defaults.fromFolderId,
  };
}

export function applyBatchRenameToDrafts(
  drafts: readonly DriveImportDraft[],
  options: { prefix?: string; suffix?: string; stripExtension?: boolean },
): DriveImportDraft[] {
  const prefix = options.prefix ?? '';
  const suffix = options.suffix ?? '';
  return drafts.map((draft) => {
    if (!draft.selected) return draft;
    let base = draft.title.trim() || draft.originalName;
    if (options.stripExtension) {
      base = base.replace(/\.[a-z0-9]{1,6}$/i, '');
    }
    return {
      ...draft,
      title: `${prefix}${base}${suffix}`.trim() || draft.originalName,
    };
  });
}

export function buildLibraryInputsFromDrafts(
  drafts: readonly DriveImportDraft[],
): PreparedDriveLibraryInput[] {
  const out: PreparedDriveLibraryInput[] = [];
  for (const draft of drafts) {
    if (!draft.selected) continue;
    // Skip folder rows whose user choice was 'expand' (its expanded child drafts are imported instead)
    if (draft.isFolder && draft.folderAction === 'expand') continue;

    const title = draft.title.trim();
    if (!title) {
      throw new Error('Vui lòng đặt tên cho tất cả các tài liệu đã chọn.');
    }
    if (!validateDriveUrl(draft.url)) {
      throw new Error(`Liên kết Google Drive không hợp lệ cho "${title}".`);
    }
    out.push({
      title,
      kind: draft.kind,
      source: 'drive',
      url: draft.url,
      driveFileId: draft.driveFileId || extractDriveFileId(draft.url),
      mimeType: draft.mimeType || undefined,
      folderId: draft.folderId ?? null,
      tags: normalizeTags(draft.tags),
      description: draft.description.trim() || undefined,
    });
  }
  return out;
}
