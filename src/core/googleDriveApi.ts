/**
 * Client-side Google Drive v3 helper for creating new Google Docs / Google Sheets
 * directly from inside a TheoLab tab using the narrow `drive.file` OAuth scope.
 */
import { APP_MODE } from '../config/runtimeConfig.js';
import { requestGoogleDriveToken } from './authGate.js';
import { getCachedVault } from './secretsVault';

export type NewGoogleFileKind = 'document' | 'spreadsheets';

export interface CreatedGoogleFile {
  id: string;
  name: string;
  kind: NewGoogleFileKind;
  url: string;
}

const MIME_BY_KIND: Record<NewGoogleFileKind, string> = {
  document: 'application/vnd.google-apps.document',
  spreadsheets: 'application/vnd.google-apps.spreadsheet',
};

export function extractDriveFolderId(folderUrl?: string): string | null {
  if (!folderUrl) return null;
  try {
    const parsed = new URL(folderUrl.trim());
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'drive.google.com') return null;
    const match = parsed.pathname.match(/\/folders\/([^/?#]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function buildGoogleEditUrl(kind: NewGoogleFileKind, fileId: string): string {
  const encoded = encodeURIComponent(fileId);
  return kind === 'spreadsheets'
    ? `https://docs.google.com/spreadsheets/d/${encoded}/edit`
    : `https://docs.google.com/document/d/${encoded}/edit`;
}

export function defaultNewFileTitle(kind: NewGoogleFileKind, now = new Date()): string {
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return kind === 'spreadsheets'
    ? `Bảng tính TheoLab · ${dd}/${mm} ${hh}:${min}`
    : `Tài liệu TheoLab · ${dd}/${mm} ${hh}:${min}`;
}

async function postDriveCreate(
  token: string,
  body: { name: string; mimeType: string; parents?: string[] },
): Promise<Response> {
  return fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function parseDriveError(response: Response): Promise<{ reason: string; message: string }> {
  try {
    const data = (await response.json()) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    return {
      reason: data.error?.errors?.[0]?.reason ?? '',
      message: data.error?.message ?? `HTTP ${response.status}`,
    };
  } catch {
    return { reason: '', message: `HTTP ${response.status}` };
  }
}

export async function createGoogleWorkspaceFile(options: {
  kind: NewGoogleFileKind;
  title?: string;
}): Promise<CreatedGoogleFile> {
  if (APP_MODE !== 'firebase_auth') {
    throw new Error('Tạo file Google mới trong tab cần chế độ firebase_auth và đăng nhập Google.');
  }

  const name = options.title?.trim() || defaultNewFileTitle(options.kind);
  const mimeType = MIME_BY_KIND[options.kind];
  const folderId = extractDriveFolderId(getCachedVault().driveFolderUrl);

  let token = await requestGoogleDriveToken();
  let response = await postDriveCreate(token, folderId ? { name, mimeType, parents: [folderId] } : { name, mimeType });

  // Retry once with a fresh OAuth token on 401.
  if (response.status === 401) {
    token = await requestGoogleDriveToken({ forceRefresh: true });
    response = await postDriveCreate(token, folderId ? { name, mimeType, parents: [folderId] } : { name, mimeType });
  }

  // With the narrow `drive.file` scope, an existing folder created outside TheoLab may not be writable.
  // Fall back cleanly to creating the file in the user's root Drive so creation still succeeds.
  if (folderId && (response.status === 403 || response.status === 404)) {
    const err = await parseDriveError(response);
    if (err.reason !== 'accessNotConfigured') {
      response = await postDriveCreate(token, { name, mimeType });
    } else {
      throw new Error(
        'Google Drive API chưa được bật trên Google Cloud project của Firebase. Hãy bật "Google Drive API" trong Google Cloud Console rồi thử lại.',
      );
    }
  }

  if (!response.ok) {
    const err = await parseDriveError(response);
    if (err.reason === 'accessNotConfigured') {
      throw new Error(
        'Google Drive API chưa được bật trên Google Cloud project của Firebase. Hãy bật "Google Drive API" trong Google Cloud Console rồi thử lại.',
      );
    }
    throw new Error(`Không thể tạo file trên Google Drive: ${err.message}`);
  }

  const created = (await response.json()) as { id?: string; name?: string };
  if (!created.id) {
    throw new Error('Google Drive không trả về ID tệp mới.');
  }

  return {
    id: created.id,
    name: created.name || name,
    kind: options.kind,
    url: buildGoogleEditUrl(options.kind, created.id),
  };
}
