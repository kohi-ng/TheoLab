import { describe, expect, it } from 'vitest';
import {
  APP_CATALOG,
  buildLibraryDockSpec,
  clampSplitRatio,
  extractCalendarEmbedUrl,
  findAppDefinition,
  isAllowedAppUrl,
  normalizeGoogleEmbedUrl,
  parsePersistedDockState,
  resolveAppUrl,
  WIDGET_SANDBOX,
} from './appCatalog';

describe('appCatalog & dock helpers', () => {
  it('includes core Google Workspace and STEM apps', () => {
    const ids = APP_CATALOG.map((app) => app.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'google-docs',
        'google-sheets',
        'google-calendar',
        'desmos',
        'jupyterlite',
        'ketcher',
      ]),
    );
  });

  it('normalizes Google Docs, Sheets, Slides, and Drive URLs for edit and preview modes', () => {
    expect(
      normalizeGoogleEmbedUrl('https://docs.google.com/document/d/abc123_XYZ/edit#heading=h.1', 'edit'),
    ).toBe('https://docs.google.com/document/d/abc123_XYZ/edit?embedded=true');

    expect(
      normalizeGoogleEmbedUrl('https://docs.google.com/document/d/abc123_XYZ/edit', 'preview'),
    ).toBe('https://docs.google.com/document/d/abc123_XYZ/preview');

    expect(
      normalizeGoogleEmbedUrl('https://docs.google.com/spreadsheets/d/sheet_99/edit?gid=0', 'edit'),
    ).toBe('https://docs.google.com/spreadsheets/d/sheet_99/edit?rm=minimal');

    expect(
      normalizeGoogleEmbedUrl('https://docs.google.com/spreadsheets/d/sheet_99/edit', 'preview'),
    ).toBe('https://docs.google.com/spreadsheets/d/sheet_99/preview');

    expect(
      normalizeGoogleEmbedUrl('https://drive.google.com/file/d/pdf_42/view?usp=sharing', 'edit'),
    ).toBe('https://drive.google.com/file/d/pdf_42/preview');
  });

  it('rejects placeholder or non-Google URLs in normalizeGoogleEmbedUrl', () => {
    expect(normalizeGoogleEmbedUrl('https://docs.google.com/document/d/REPLACE_WITH_ID/edit')).toBeNull();
    expect(normalizeGoogleEmbedUrl('https://evil.example.com/document/d/abc/edit')).toBeNull();
    expect(normalizeGoogleEmbedUrl('javascript:alert(1)')).toBeNull();
  });

  it('extracts and validates Google Calendar embed URLs from direct links and iframe snippets', () => {
    const direct = 'https://calendar.google.com/calendar/embed?src=owner%40gmail.com&ctz=Asia%2FHo_Chi_Minh';
    expect(extractCalendarEmbedUrl(direct)).toBe(direct);

    const snippet =
      '<iframe src="https://calendar.google.com/calendar/embed?src=owner%40gmail.com&amp;ctz=Asia%2FHo_Chi_Minh" style="border: 0"></iframe>';
    expect(extractCalendarEmbedUrl(snippet)).toBe(direct);

    expect(extractCalendarEmbedUrl('https://calendar.google.com/calendar/u/0/r')).toBeNull();
    expect(extractCalendarEmbedUrl('https://example.com/calendar/embed?src=a')).toBeNull();
  });

  it('validates custom app URLs safely', () => {
    expect(isAllowedAppUrl('https://www.desmos.com/calculator')).toBe(true);
    expect(isAllowedAppUrl('http://localhost:8888/lab')).toBe(true);
    expect(isAllowedAppUrl('http://127.0.0.1:4173')).toBe(true);
    expect(isAllowedAppUrl('http://example.com')).toBe(false);
    expect(isAllowedAppUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedAppUrl('data:text/html,<h1>x</h1>')).toBe(false);
  });

  it('resolves Vault self-hosted overrides when valid and falls back otherwise', () => {
    const jupyter = findAppDefinition('jupyterlite')!;
    expect(resolveAppUrl(jupyter, { jupyterLiteUrl: 'https://kohi-ng.github.io/theolab-apps/jupyterlite/' })).toBe(
      'https://kohi-ng.github.io/theolab-apps/jupyterlite/',
    );
    expect(resolveAppUrl(jupyter, { jupyterLiteUrl: 'javascript:alert(1)' })).toBe(jupyter.defaultUrl);

    const calendar = findAppDefinition('google-calendar')!;
    const calUrl = 'https://calendar.google.com/calendar/embed?src=test%40gmail.com';
    expect(resolveAppUrl(calendar, { calendarEmbedUrl: calUrl })).toBe(calUrl);
    expect(resolveAppUrl(calendar, { calendarEmbedUrl: 'https://calendar.google.com/calendar/u/0/r' })).toBe('');
  });

  it('converts Library items into dock specs with proper sandboxing', () => {
    const sheetSpec = buildLibraryDockSpec({
      id: 'lib-1',
      title: 'Số liệu chuẩn độ',
      type: 'google',
      url: 'https://docs.google.com/spreadsheets/d/abc123/edit',
    });
    expect(sheetSpec?.appId).toBe('google-sheets');
    expect(sheetSpec?.googleMode).toBe('edit');
    expect(sheetSpec?.url).toBe('https://docs.google.com/spreadsheets/d/abc123/edit?rm=minimal');

    const widgetSpec = buildLibraryDockSpec(
      {
        id: 'lib-w',
        title: 'Mô phỏng chuẩn độ',
        type: 'widget',
        widget: { file: 'demo-titration.html' },
      },
      '/TheoLab/',
    );
    expect(widgetSpec?.url).toBe('/TheoLab/widgets/demo-titration.html');
    expect(widgetSpec?.sandbox).toBe(WIDGET_SANDBOX);

    const traversalPdf = buildLibraryDockSpec({
      id: 'bad-pdf',
      title: 'Bad',
      type: 'pdf',
      file: '../secret.pdf',
    });
    expect(traversalPdf).toBeNull();
  });

  it('sanitizes persisted localStorage dock state and clamps split ratios', () => {
    expect(clampSplitRatio(0.1)).toBe(0.26);
    expect(clampSplitRatio(0.95)).toBe(0.74);

    const raw = JSON.stringify({
      version: 1,
      open: true,
      expanded: false,
      splitRatio: 0.9,
      activeTabId: 't-1',
      tabs: [
        { id: 't-1', kind: 'app', appId: 'desmos', title: 'Desmos', icon: '∫', url: 'https://www.desmos.com/calculator' },
        { id: 't-evil', kind: 'custom-url', title: 'Evil', icon: 'x', url: 'javascript:alert(1)' },
      ],
    });

    const parsed = parsePersistedDockState(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.splitRatio).toBe(0.74);
    expect(parsed?.tabs).toHaveLength(1);
    expect(parsed?.tabs[0]?.id).toBe('t-1');
    expect(parsed?.activeTabId).toBe('t-1');
  });
});
