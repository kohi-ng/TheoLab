/**
 * Curated catalog of embeddable workspace apps and pure URL/state helpers
 * for the TheoLab right-pane Multi-Tab Dock.
 */
import type { OwnerVaultData } from '../../core/secretsVault';
import { parseExerciseTabPayload, type ExerciseTabPayload } from '../theon/exerciseSchema';

export type AppCategoryId = 'google' | 'stem' | 'tools';
export type AppKind = 'iframe' | 'google-doc' | 'google-sheet' | 'google-calendar' | 'native';
export type NativeAppId = 'theon' | 'exercise';
export type GoogleEmbedMode = 'edit' | 'preview';

export interface AppCategory {
  id: AppCategoryId;
  label: string;
}

export interface AppDefinition {
  id: string;
  name: string;
  shortName: string;
  category: AppCategoryId;
  icon: string;
  description: string;
  kind: AppKind;
  nativeAppId?: NativeAppId;
  defaultUrl: string;
  vaultOverrideKey?: keyof Pick<OwnerVaultData, 'calendarEmbedUrl' | 'jupyterLiteUrl' | 'ketcherUrl' | 'desmosUrl'>;
  externalCreateUrl?: string;
  externalHomeUrl?: string;
  sandbox: string;
  allow?: string;
  allowMultiple: boolean;
}

export interface DockTab {
  id: string;
  kind: 'app' | 'library-doc' | 'custom-url' | 'native-app';
  appId?: string;
  nativeAppId?: NativeAppId;
  exercisePayload?: ExerciseTabPayload;
  libraryItemId?: string;
  title: string;
  icon: string;
  url: string;
  sourceUrl?: string;
  googleMode?: GoogleEmbedMode;
  sandbox: string;
  allow?: string;
  reloadNonce?: number;
}

export interface PersistedDockState {
  version: 1;
  open: boolean;
  expanded: boolean;
  splitRatio: number;
  activeTabId: string | null;
  tabs: Omit<DockTab, 'reloadNonce'>[];
}

export interface LibraryDockInput {
  id: string;
  title: string;
  type: string;
  kind?: string;
  mimeType?: string;
  url?: string;
  file?: string;
  sourceLabel?: string;
  widget?: {
    file?: string;
    title?: string;
  };
}

export const EXTERNAL_APP_SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals';

export const WIDGET_SANDBOX = 'allow-scripts';

export const APP_CATEGORIES: readonly AppCategory[] = Object.freeze([
  { id: 'google', label: 'Google Workspace' },
  { id: 'stem', label: 'Toán & Khoa học (STEM)' },
  { id: 'tools', label: 'Bảng vẽ & Tiện ích' },
]);

export const APP_CATALOG: readonly AppDefinition[] = Object.freeze([
  {
    id: 'google-docs',
    name: 'Google Docs',
    shortName: 'Docs',
    category: 'google',
    icon: '▤',
    description: 'Mở và soạn tài liệu Google Docs từ Thư viện hoặc liên kết trực tiếp.',
    kind: 'google-doc',
    defaultUrl: '',
    externalCreateUrl: 'https://docs.new',
    externalHomeUrl: 'https://docs.google.com/document/u/0/',
    sandbox: EXTERNAL_APP_SANDBOX,
    allow: 'clipboard-read; clipboard-write; fullscreen',
    allowMultiple: true,
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets (Excel)',
    shortName: 'Sheets',
    category: 'google',
    icon: '▦',
    description: 'Mở và xử lý bảng tính, số liệu thí nghiệm trên Google Sheets.',
    kind: 'google-sheet',
    defaultUrl: '',
    externalCreateUrl: 'https://sheets.new',
    externalHomeUrl: 'https://docs.google.com/spreadsheets/u/0/',
    sandbox: EXTERNAL_APP_SANDBOX,
    allow: 'clipboard-read; clipboard-write; fullscreen',
    allowMultiple: true,
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    shortName: 'Calendar',
    category: 'google',
    icon: '◷',
    description: 'Xem lịch học cá nhân qua liên kết nhúng lưu trong Firestore Vault.',
    kind: 'google-calendar',
    defaultUrl: '',
    vaultOverrideKey: 'calendarEmbedUrl',
    externalHomeUrl: 'https://calendar.google.com',
    sandbox: EXTERNAL_APP_SANDBOX,
    allow: 'fullscreen',
    allowMultiple: false,
  },
  {
    id: 'desmos',
    name: 'Desmos Graphing',
    shortName: 'Desmos',
    category: 'stem',
    icon: '∫',
    description: 'Vẽ đồ thị hàm số, đường chuẩn độ và phương trình tương tác.',
    kind: 'iframe',
    defaultUrl: 'https://www.desmos.com/calculator',
    vaultOverrideKey: 'desmosUrl',
    externalHomeUrl: 'https://www.desmos.com/calculator',
    sandbox: EXTERNAL_APP_SANDBOX,
    allow: 'clipboard-read; clipboard-write; fullscreen',
    allowMultiple: true,
  },
  {
    id: 'desmos-scientific',
    name: 'Desmos Scientific',
    shortName: 'Calc',
    category: 'stem',
    icon: '∑',
    description: 'Máy tính khoa học nhanh cho pH, log, hằng số cân bằng.',
    kind: 'iframe',
    defaultUrl: 'https://www.desmos.com/scientific',
    externalHomeUrl: 'https://www.desmos.com/scientific',
    sandbox: EXTERNAL_APP_SANDBOX,
    allow: 'clipboard-read; clipboard-write',
    allowMultiple: false,
  },
  {
    id: 'desmos-3d',
    name: 'Desmos 3D',
    shortName: 'Desmos 3D',
    category: 'stem',
    icon: '◇',
    description: 'Vẽ mặt cong và hình học không gian 3D.',
    kind: 'iframe',
    defaultUrl: 'https://www.desmos.com/3d',
    externalHomeUrl: 'https://www.desmos.com/3d',
    sandbox: EXTERNAL_APP_SANDBOX,
    allow: 'fullscreen',
    allowMultiple: true,
  },
  {
    id: 'jupyterlite',
    name: 'JupyterLite',
    shortName: 'JupyterLite',
    category: 'stem',
    icon: '⌘',
    description: 'Python & Notebook chạy ngay trong trình duyệt (WASM / Pyodide).',
    kind: 'iframe',
    defaultUrl: 'https://jupyterlite.github.io/demo/lab/index.html',
    vaultOverrideKey: 'jupyterLiteUrl',
    externalHomeUrl: 'https://jupyterlite.github.io/demo/lab/index.html',
    sandbox: EXTERNAL_APP_SANDBOX,
    allow: 'clipboard-read; clipboard-write; fullscreen',
    allowMultiple: true,
  },
  {
    id: 'ketcher',
    name: 'Ketcher',
    shortName: 'Ketcher',
    category: 'stem',
    icon: '⬡',
    description: 'Trình vẽ cấu trúc phân tử hóa học 2D & phản ứng (EPAM Ketcher).',
    kind: 'iframe',
    defaultUrl: 'https://lifescience.opensource.epam.com/KetcherDemoSA/index.html',
    vaultOverrideKey: 'ketcherUrl',
    externalHomeUrl: 'https://lifescience.opensource.epam.com/KetcherDemoSA/index.html',
    sandbox: EXTERNAL_APP_SANDBOX,
    allow: 'clipboard-read; clipboard-write; fullscreen',
    allowMultiple: true,
  },
  {
    id: 'geogebra',
    name: 'GeoGebra',
    shortName: 'GeoGebra',
    category: 'stem',
    icon: '△',
    description: 'Máy tính đồ thị, hình học và giải tích tương tác.',
    kind: 'iframe',
    defaultUrl: 'https://www.geogebra.org/calculator',
    externalHomeUrl: 'https://www.geogebra.org/calculator',
    sandbox: EXTERNAL_APP_SANDBOX,
    allow: 'fullscreen',
    allowMultiple: true,
  },
  {
    id: 'molview',
    name: 'MolView 3D',
    shortName: 'MolView',
    category: 'stem',
    icon: '⚛',
    description: 'Quan sát mô hình phân tử 3D và phổ cơ bản.',
    kind: 'iframe',
    defaultUrl: 'https://molview.org/',
    externalHomeUrl: 'https://molview.org/',
    sandbox: EXTERNAL_APP_SANDBOX,
    allow: 'fullscreen',
    allowMultiple: false,
  },
  {
    id: 'theon',
    name: 'Theon (Planar AI)',
    shortName: 'Theon',
    category: 'tools',
    icon: '◈',
    description: 'Nhân dạng 3D Theon mở thành ô bên khung phải, trả lời trực tiếp bằng hiệu ứng ma trận chữ.',
    kind: 'native',
    nativeAppId: 'theon',
    defaultUrl: '',
    sandbox: '',
    allowMultiple: false,
  },
  {
    id: 'excalidraw',
    name: 'Excalidraw',
    shortName: 'Bảng trắng',
    category: 'tools',
    icon: '✎',
    description: 'Bảng trắng phác thảo sơ đồ tư duy, cơ chế phản ứng và ghi chú nhanh.',
    kind: 'iframe',
    defaultUrl: 'https://excalidraw.com',
    externalHomeUrl: 'https://excalidraw.com',
    sandbox: EXTERNAL_APP_SANDBOX,
    allow: 'clipboard-read; clipboard-write; fullscreen',
    allowMultiple: true,
  },
]);

export function findAppDefinition(appId: string): AppDefinition | undefined {
  return APP_CATALOG.find((app) => app.id === appId);
}

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(0.74, Math.max(0.26, ratio));
}

export function isAllowedAppUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export type GoogleServiceKind = 'document' | 'spreadsheets' | 'presentation' | 'drive';

export function detectGoogleService(rawUrl: string): GoogleServiceKind | null {
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== 'https:') return null;
    if (!['docs.google.com', 'drive.google.com'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/(document|spreadsheets|presentation)\/d\//);
    if (match?.[1]) return match[1] as GoogleServiceKind;
    return 'drive';
  } catch {
    return null;
  }
}

/**
 * Normalizes a Google Docs / Sheets / Slides / Drive URL into an iframe-embeddable URL.
 * Returns null if the link is not a supported Google file URL or contains a placeholder ID.
 */
export function normalizeGoogleEmbedUrl(rawUrl: string, mode: GoogleEmbedMode = 'edit'): string | null {
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== 'https:') return null;
    if (!['docs.google.com', 'drive.google.com'].includes(url.hostname)) return null;
    const id = url.pathname.match(/\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d)\/([^/]+)/)?.[1]
      ?? url.searchParams.get('id');
    if (!id || id.startsWith('REPLACE_')) return null;

    const service = url.pathname.match(/^\/(document|spreadsheets|presentation)\/d\//)?.[1];
    const encodedId = encodeURIComponent(id);
    if (service === 'document') {
      return mode === 'edit'
        ? `https://docs.google.com/document/d/${encodedId}/edit?embedded=true`
        : `https://docs.google.com/document/d/${encodedId}/preview`;
    }
    if (service === 'spreadsheets') {
      return mode === 'edit'
        ? `https://docs.google.com/spreadsheets/d/${encodedId}/edit?rm=minimal`
        : `https://docs.google.com/spreadsheets/d/${encodedId}/preview`;
    }
    if (service === 'presentation') {
      return mode === 'edit'
        ? `https://docs.google.com/presentation/d/${encodedId}/edit?rm=minimal`
        : `https://docs.google.com/presentation/d/${encodedId}/preview`;
    }
    return `https://drive.google.com/file/d/${encodedId}/preview`;
  } catch {
    return null;
  }
}

/**
 * Accepts either a direct Google Calendar embed URL or a full <iframe> snippet copied
 * from Google Calendar Settings -> Integrate calendar, and returns a validated embed URL.
 */
export function extractCalendarEmbedUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const iframeSrcMatch = trimmed.match(/src=["']([^"']+)["']/i);
  const candidate = (iframeSrcMatch?.[1] ?? trimmed).replace(/&amp;/g, '&').trim();
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname !== 'calendar.google.com') return null;
    if (!parsed.pathname.startsWith('/calendar/embed')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function resolveAppUrl(app: AppDefinition, vault: OwnerVaultData): string {
  if (app.vaultOverrideKey) {
    const override = vault[app.vaultOverrideKey]?.trim();
    if (override) {
      if (app.kind === 'google-calendar') {
        const extracted = extractCalendarEmbedUrl(override);
        if (extracted) return extracted;
      } else if (isAllowedAppUrl(override)) {
        return override;
      }
    }
  }
  return app.defaultUrl;
}

export function buildLibraryDockSpec(
  item: LibraryDockInput,
  baseUrl = '/',
): {
  title: string;
  icon: string;
  url: string;
  sourceUrl?: string;
  appId?: string;
  googleMode?: GoogleEmbedMode;
  sandbox: string;
  allow?: string;
} | null {
  const effectiveKind = item.kind ?? item.type;
  const isGoogle =
    item.type === 'google' ||
    effectiveKind === 'google-doc' ||
    effectiveKind === 'google-sheet' ||
    effectiveKind === 'google-slide' ||
    effectiveKind === 'drive-file';

  if (isGoogle && item.url) {
    if (item.mimeType === 'application/vnd.google-apps.folder' || item.url.includes('/folders/')) {
      return null;
    }
    const service = detectGoogleService(item.url);
    const mode: GoogleEmbedMode = service === 'document' || service === 'spreadsheets' ? 'edit' : 'preview';
    const embedUrl = normalizeGoogleEmbedUrl(item.url, mode);
    if (!embedUrl) return null;
    const icon = service === 'spreadsheets' ? '▦' : service === 'document' ? '▤' : '▣';
    const appId = service === 'spreadsheets' ? 'google-sheets' : service === 'document' ? 'google-docs' : undefined;
    return {
      title: item.title,
      icon,
      url: embedUrl,
      sourceUrl: item.url,
      appId,
      googleMode: mode,
      sandbox: EXTERNAL_APP_SANDBOX,
      allow: 'clipboard-read; clipboard-write; fullscreen',
    };
  }

  if (effectiveKind === 'pdf' && item.file) {
    const segments = String(item.file).split('/');
    if (!segments.length || segments.some((s) => !/^[\w.-]+$/.test(s) || s === '.' || s === '..')) {
      return null;
    }
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const pdfUrl = `${normalizedBase}docs/${segments.map(encodeURIComponent).join('/')}`;
    return {
      title: item.title,
      icon: '📄',
      url: pdfUrl,
      sourceUrl: pdfUrl,
      sandbox: EXTERNAL_APP_SANDBOX,
    };
  }

  if (effectiveKind === 'widget' && item.widget?.file) {
    const filename = String(item.widget.file);
    if (!/^[\w.-]+\.html$/i.test(filename)) return null;
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return {
      title: item.title,
      icon: '⚗',
      url: `${normalizedBase}widgets/${encodeURIComponent(filename)}`,
      sandbox: WIDGET_SANDBOX,
    };
  }

  return null;
}

export function isSafeTabUrl(url: string): boolean {
  if (!url) return true; // empty URL is allowed for in-tab setup launchers (Docs/Sheets/Calendar)
  if (url.startsWith('/')) return true; // same-origin static PDF / widget path
  return isAllowedAppUrl(url);
}

export function parsePersistedDockState(raw: string | null): PersistedDockState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedDockState>;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tabs)) return null;

    const validTabs: Omit<DockTab, 'reloadNonce'>[] = [];
    for (const candidate of parsed.tabs) {
      if (!candidate || typeof candidate !== 'object') continue;
      const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : null;
      const title = typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title : null;
      const url = typeof candidate.url === 'string' ? candidate.url : '';
      if (!id || !title || !isSafeTabUrl(url)) continue;

      const kind: DockTab['kind'] =
        candidate.kind === 'library-doc' ||
        candidate.kind === 'custom-url' ||
        candidate.kind === 'native-app'
          ? candidate.kind
          : 'app';

      const nativeAppId: NativeAppId | undefined =
        candidate.nativeAppId === 'theon' || candidate.nativeAppId === 'exercise'
          ? candidate.nativeAppId
          : undefined;
      if (kind === 'native-app' && !nativeAppId) continue;

      const exercisePayload =
        kind === 'native-app' && nativeAppId === 'exercise'
          ? (parseExerciseTabPayload(candidate.exercisePayload) ?? undefined)
          : undefined;
      if (kind === 'native-app' && nativeAppId === 'exercise' && !exercisePayload) continue;

      const sandbox =
        kind === 'native-app'
          ? ''
          : candidate.sandbox === WIDGET_SANDBOX
            ? WIDGET_SANDBOX
            : EXTERNAL_APP_SANDBOX;

      validTabs.push({
        id,
        kind,
        appId: typeof candidate.appId === 'string' ? candidate.appId : undefined,
        nativeAppId,
        exercisePayload,
        libraryItemId: typeof candidate.libraryItemId === 'string' ? candidate.libraryItemId : undefined,
        title: title.slice(0, 80),
        icon: typeof candidate.icon === 'string' && candidate.icon.trim() ? candidate.icon.slice(0, 4) : '⊞',
        url: kind === 'native-app' ? '' : url,
        sourceUrl: typeof candidate.sourceUrl === 'string' && isSafeTabUrl(candidate.sourceUrl) ? candidate.sourceUrl : undefined,
        googleMode: candidate.googleMode === 'preview' ? 'preview' : candidate.googleMode === 'edit' ? 'edit' : undefined,
        sandbox,
        allow: typeof candidate.allow === 'string' ? candidate.allow : undefined,
      });
    }

    const activeTabId =
      typeof parsed.activeTabId === 'string' && validTabs.some((t) => t.id === parsed.activeTabId)
        ? parsed.activeTabId
        : (validTabs[0]?.id ?? null);

    return {
      version: 1,
      open: Boolean(parsed.open) && validTabs.length > 0,
      expanded: Boolean(parsed.expanded) && Boolean(parsed.open) && validTabs.length > 0,
      splitRatio: clampSplitRatio(typeof parsed.splitRatio === 'number' ? parsed.splitRatio : 0.5),
      activeTabId,
      tabs: validTabs,
    };
  } catch {
    return null;
  }
}
