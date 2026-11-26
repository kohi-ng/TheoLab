import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultTheonSettings,
  parseTheonSettings,
  THEON_MODEL_PRESETS,
} from './theonConfig';
import { detectExpressionFromText, renderMatrixFrame } from './matrixText';
import { executeTheonTool } from './theonTools';
import { findAppDefinition, parsePersistedDockState } from '../apps/appCatalog';

describe('Theon config & settings', () => {
  it('defaults to a fixed box (parallax disabled) and valid model preset', () => {
    const defaults = createDefaultTheonSettings();
    expect(defaults.parallaxEnabled).toBe(false);
    expect(defaults.autoExpression).toBe(true);
    expect(defaults.defaultExpression).toBe('friendly');
    expect(THEON_MODEL_PRESETS[defaults.provider].length).toBeGreaterThan(0);
  });

  it('merges valid partial JSON settings and rejects invalid shapes safely', () => {
    const valid = parseTheonSettings(
      JSON.stringify({
        provider: 'openai',
        model: 'gpt-4.1-mini',
        temperature: 0.7,
        headStyle: 'translucent',
        edgeBrightness: 0.5,
      }),
    );
    expect(valid.provider).toBe('openai');
    expect(valid.model).toBe('gpt-4.1-mini');
    expect(valid.headStyle).toBe('translucent');
    expect(valid.parallaxEnabled).toBe(false);

    const invalid = parseTheonSettings(JSON.stringify({ provider: 'unknown_vendor', temperature: 99 }));
    expect(invalid.provider).toBe(createDefaultTheonSettings().provider);
  });
});

describe('Theon matrix text & expression heuristics', () => {
  it('progressively decodes text while preserving spaces and newlines', () => {
    const target = 'Xin chào\nTheoLab!';
    const mid = renderMatrixFrame(target, 0.45, 3);
    expect(mid.includes('\n')).toBe(true);
    expect(mid.length).toBeLessThanOrEqual(target.length);
    expect(renderMatrixFrame(target, 1, 9)).toBe(target);
  });

  it('maps Vietnamese sentence cues to appropriate fallback expressions', () => {
    expect(detectExpressionFromText('Cảnh báo: thiếu API Key để gọi mô hình.')).toBe('serious');
    expect(detectExpressionFromText('Chính xác! Kết quả pH rất tốt.')).toBe('happy');
    expect(detectExpressionFromText('Tại sao phản ứng này lại thuận nghịch?')).toBe('thoughtful');
    expect(detectExpressionFromText('Bước 1: tính hằng số Ka và pKa từ công thức.')).toBe('focused');
  });
});

describe('Theon expression tool execution', () => {
  it('validates set_expression arguments via Zod and invokes handler', () => {
    const onSetExpression = vi.fn();
    const ok = executeTheonTool(
      'set_expression',
      JSON.stringify({ expression: 'thoughtful', reason: 'đang phân tích câu hỏi mở' }),
      { onSetExpression },
    );
    expect(ok.ok).toBe(true);
    expect(onSetExpression).toHaveBeenCalledWith('thoughtful', 'đang phân tích câu hỏi mở');

    const badExpr = executeTheonTool('set_expression', { expression: 'angry' }, { onSetExpression });
    expect(badExpr.ok).toBe(false);

    const badJson = executeTheonTool('set_expression', '{not-json', { onSetExpression });
    expect(badJson.ok).toBe(false);

    const unknownTool = executeTheonTool('delete_all', {}, { onSetExpression });
    expect(unknownTool.ok).toBe(false);
  });
});

describe('Theon native dock registration', () => {
  it('registers Theon as a single-instance native app and validates persisted native tabs', () => {
    const def = findAppDefinition('theon');
    expect(def).toBeDefined();
    expect(def?.kind).toBe('native');
    expect(def?.nativeAppId).toBe('theon');
    expect(def?.allowMultiple).toBe(false);

    const parsed = parsePersistedDockState(
      JSON.stringify({
        version: 1,
        open: true,
        expanded: false,
        splitRatio: 0.5,
        activeTabId: 'tab-theon',
        tabs: [
          { id: 'tab-theon', kind: 'native-app', appId: 'theon', nativeAppId: 'theon', title: 'Theon', icon: '◈', url: '' },
          { id: 'tab-bad', kind: 'native-app', nativeAppId: 'evil-app', title: 'Bad', icon: 'x', url: '' },
        ],
      }),
    );

    expect(parsed?.tabs).toHaveLength(1);
    expect(parsed?.tabs[0]?.nativeAppId).toBe('theon');
    expect(parsed?.tabs[0]?.kind).toBe('native-app');
  });
});
