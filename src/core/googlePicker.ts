/**
 * Lazy-loaded Google Picker API client for selecting Drive files & folders.
 *
 * Security & scope:
 * - Uses the existing narrow `drive.file` OAuth access token from `authGate.js`.
 * - Files selected through Picker with `.setAppId(VITE_GOOGLE_PICKER_APP_ID)` are
 *   automatically granted `drive.file` access for this app.
 * - Picker script (`https://apis.google.com/js/api.js`) is only loaded on demand.
 */
import { APP_MODE, googlePickerConfig, isGooglePickerConfigured } from '../config/runtimeConfig.js';
import { requestGoogleDriveToken } from './authGate.js';
import type { GooglePickerDocument } from '../domain/library/driveMapper';

const GAPI_SCRIPT_SRC = 'https://apis.google.com/js/api.js';

interface GooglePickerResponse {
  action?: string;
  docs?: GooglePickerDocument[];
}

interface GooglePickerApi {
  Action: { PICKED: string; CANCEL: string };
  Feature: { MULTISELECT_ENABLED: string; NAV_HIDDEN: string };
  ViewId: { DOCS: string; FOLDERS: string };
  DocsView: new (viewId?: string) => {
    setIncludeFolders(include: boolean): unknown;
    setSelectFolderEnabled(enabled: boolean): unknown;
    setLabel(label: string): unknown;
  };
  PickerBuilder: new () => {
    addView(view: unknown): unknown;
    enableFeature(feature: string): unknown;
    setOAuthToken(token: string): unknown;
    setDeveloperKey(key: string): unknown;
    setAppId(appId: string): unknown;
    setLocale(locale: string): unknown;
    setTitle(title: string): unknown;
    setOrigin(origin: string): unknown;
    setCallback(cb: (data: GooglePickerResponse) => void): unknown;
    build(): { setVisible(visible: boolean): void };
  };
}

interface GapiGlobal {
  load(api: string, options: { callback: () => void; onerror?: () => void; timeout?: number; ontimeout?: () => void }): void;
}

declare global {
  interface Window {
    gapi?: GapiGlobal;
    google?: {
      picker?: GooglePickerApi;
    };
  }
}

export interface PickerResult {
  cancelled: boolean;
  docs: GooglePickerDocument[];
}

let pickerLoaderPromise: Promise<GooglePickerApi> | null = null;

function loadGapiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Google Picker chỉ hoạt động trên trình duyệt.'));
      return;
    }
    if (window.gapi) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GAPI_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Không thể tải Google Picker API (có thể bị chặn mạng hoặc trình chặn quảng cáo).')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = GAPI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Không thể tải Google Picker API (kiểm tra kết nối mạng hoặc trình chặn quảng cáo).'));
    document.head.append(script);
  });
}

export async function loadGooglePickerApi(): Promise<GooglePickerApi> {
  if (typeof window !== 'undefined' && window.google?.picker) {
    return window.google.picker;
  }
  if (!pickerLoaderPromise) {
    pickerLoaderPromise = (async () => {
      await loadGapiScript();
      if (!window.gapi) {
        throw new Error('Google API client (gapi) không khởi tạo được.');
      }
      await new Promise<void>((resolve, reject) => {
        window.gapi!.load('picker', {
          callback: () => resolve(),
          onerror: () => reject(new Error('Không thể nạp module Google Picker API.')),
          timeout: 15_000,
          ontimeout: () => reject(new Error('Hết thời gian chờ khi tải Google Picker API.')),
        });
      });
      if (!window.google?.picker) {
        throw new Error('Google Picker API không sẵn sàng sau khi tải.');
      }
      return window.google.picker;
    })().catch((error) => {
      pickerLoaderPromise = null;
      throw error;
    });
  }
  return pickerLoaderPromise;
}

export function formatPickerError(error: unknown): string {
  const err = error as { code?: string; message?: string };
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '');

  if (code === 'auth/popup-blocked' || /popup[-_\s]?blocked/i.test(msg)) {
    return 'Trình duyệt đã chặn cửa sổ đăng nhập Google. Hãy cho phép popup cho trang này rồi thử lại.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Bạn đã đóng cửa sổ đăng nhập Google trước khi hoàn tất.';
  }
  if (/accessNotConfigured|API_KEY_SERVICE_BLOCKED|Picker API has not been used/i.test(msg)) {
    return 'Google Picker API hoặc Google Drive API chưa được bật trên Google Cloud project. Xem hướng dẫn trong SETUP.md.';
  }
  if (/invalid.*api.*key|API_KEY_INVALID/i.test(msg)) {
    return 'VITE_GOOGLE_PICKER_API_KEY không hợp lệ hoặc bị giới hạn referrer sai tên miền.';
  }
  return msg || 'Không thể mở Google Drive Picker.';
}

/**
 * Opens Google Drive Picker allowing multi-selection of both files and folders.
 */
export async function openGoogleDrivePicker(
  options: { forceRefreshToken?: boolean } = {},
): Promise<PickerResult> {
  if (APP_MODE !== 'firebase_auth') {
    throw new Error(
      'Chọn tệp trực tiếp từ Google Drive cần chế độ firebase_auth (đăng nhập Google). Ở chế độ dev_mock, bạn vẫn có thể thêm bằng mục "Dán liên kết".',
    );
  }
  if (!isGooglePickerConfigured()) {
    throw new Error(
      'Chưa cấu hình VITE_GOOGLE_PICKER_API_KEY và VITE_GOOGLE_PICKER_APP_ID. Xem hướng dẫn bật Google Picker API trong SETUP.md, hoặc dùng mục "Dán liên kết".',
    );
  }

  let token: string;
  try {
    token = await requestGoogleDriveToken({ forceRefresh: Boolean(options.forceRefreshToken) });
  } catch (error) {
    throw new Error(formatPickerError(error));
  }

  let pickerApi: GooglePickerApi;
  try {
    pickerApi = await loadGooglePickerApi();
  } catch (error) {
    throw new Error(formatPickerError(error));
  }

  return new Promise<PickerResult>((resolve, reject) => {
    try {
      const docsView = new pickerApi.DocsView(pickerApi.ViewId.DOCS);
      docsView.setIncludeFolders(true);
      docsView.setSelectFolderEnabled(true);
      docsView.setLabel('Tệp & Thư mục Google Drive');

      const foldersView = new pickerApi.DocsView(pickerApi.ViewId.FOLDERS);
      foldersView.setIncludeFolders(true);
      foldersView.setSelectFolderEnabled(true);
      foldersView.setLabel('Thư mục Drive');

      const builder = new pickerApi.PickerBuilder();
      builder.setTitle('Chọn tệp hoặc thư mục từ Google Drive');
      builder.setLocale('vi');
      builder.setDeveloperKey(googlePickerConfig.apiKey.trim());
      builder.setAppId(googlePickerConfig.appId.trim());
      builder.setOAuthToken(token);
      builder.setOrigin(`${window.location.protocol}//${window.location.host}`);
      builder.enableFeature(pickerApi.Feature.MULTISELECT_ENABLED);
      builder.addView(docsView);
      builder.addView(foldersView);
      builder.setCallback((data: GooglePickerResponse) => {
        if (data.action === pickerApi.Action.PICKED) {
          resolve({ cancelled: false, docs: Array.isArray(data.docs) ? data.docs : [] });
        } else if (data.action === pickerApi.Action.CANCEL) {
          resolve({ cancelled: true, docs: [] });
        }
      });

      const picker = builder.build();
      picker.setVisible(true);
    } catch (error) {
      reject(new Error(formatPickerError(error)));
    }
  });
}
