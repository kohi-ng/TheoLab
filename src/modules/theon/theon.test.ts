import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultTheonSettings,
  parseTheonSettings,
  THEON_MODEL_PRESETS,
} from './theonConfig';
import { detectExpressionFromText, renderMatrixFrame } from './matrixText';
import { executeTheonTool, getActiveTheonToolSpecs } from './theonTools';
import { ExerciseTabPayloadSchema, parseExerciseTabPayload } from './exerciseSchema';
import { findAppDefinition, parsePersistedDockState } from '../apps/appCatalog';
import { normalizeAiMarkdown, stripFormattingForSpeech } from './theonReplyFormatter';
import { pcm16ToWavBytes, resolveOpenAiTtsEndpoint } from './theonVoice';

describe('Theon config & settings', () => {
  it('defaults to a fixed box (parallax disabled), enabled multiagent skills, and valid model preset', () => {
    const defaults = createDefaultTheonSettings();
    expect(defaults.parallaxEnabled).toBe(false);
    expect(defaults.autoExpression).toBe(true);
    expect(defaults.defaultExpression).toBe('friendly');
    expect(defaults.enabledSkills).toContain('kb_librarian');
    expect(defaults.enabledSkills).toContain('exercise_architect');
    expect(defaults.mcpEnabled).toBe(false);
    expect(THEON_MODEL_PRESETS[defaults.provider]?.length ?? 0).toBeGreaterThan(0);
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

    const customProvider = parseTheonSettings(
      JSON.stringify({ provider: 'custom-ollama', model: 'qwen2.5:14b' }),
    );
    expect(customProvider.provider).toBe('custom-ollama');
    expect(customProvider.model).toBe('qwen2.5:14b');

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

describe('Theon Multiagent tool execution', () => {
  it('validates set_expression arguments via Zod and invokes handler', async () => {
    const onSetExpression = vi.fn();
    const ok = await executeTheonTool(
      'set_expression',
      JSON.stringify({ expression: 'thoughtful', reason: 'đang phân tích câu hỏi mở' }),
      { onSetExpression },
    );
    expect(ok.ok).toBe(true);
    expect(onSetExpression).toHaveBeenCalledWith('thoughtful', 'đang phân tích câu hỏi mở');

    const badExpr = await executeTheonTool('set_expression', { expression: 'angry' }, { onSetExpression });
    expect(badExpr.ok).toBe(false);

    const badJson = await executeTheonTool('set_expression', '{not-json', { onSetExpression });
    expect(badJson.ok).toBe(false);

    const unknownTool = await executeTheonTool('delete_all', {}, { onSetExpression });
    expect(unknownTool.ok).toBe(false);
  });

  it('loads enabled skills via read_skill and blocks disabled skills', async () => {
    const settings = createDefaultTheonSettings();
    const ok = await executeTheonTool(
      'read_skill',
      { skill_id: 'exercise_architect' },
      { settings, onSetExpression: vi.fn() },
    );
    expect(ok.ok).toBe(true);
    expect(String(ok.result?.instructions)).toContain('open_exercise_tab');

    const disabledSettings = { ...settings, enabledSkills: ['kb_librarian' as const] };
    const blocked = await executeTheonTool(
      'read_skill',
      { skill_id: 'exercise_architect' },
      { settings: disabledSettings, onSetExpression: vi.fn() },
    );
    expect(blocked.ok).toBe(false);
  });

  it('spawns clickable 3D books and tags and blocks unsafe URLs', async () => {
    const onSpawnBook = vi.fn();
    const onSpawnTag = vi.fn();

    const bookRes = await executeTheonTool(
      'spawn_book',
      {
        title: 'Chuẩn độ Acid-Base',
        subtitle: 'Hóa phân tích',
        deep_link: '#/hoa-phan-tich/ch-1/u-1/t-1',
      },
      { onSetExpression: vi.fn(), onSpawnBook },
    );
    expect(bookRes.ok).toBe(true);
    expect(bookRes.result?.clickable).toBe(true);
    expect(onSpawnBook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Chuẩn độ Acid-Base',
        actionMeta: expect.objectContaining({ kind: 'deep-link', deepLink: '#/hoa-phan-tich/ch-1/u-1/t-1' }),
      }),
    );

    const evilBook = await executeTheonTool(
      'spawn_book',
      { title: 'Evil', url: 'javascript:alert(1)' },
      { onSetExpression: vi.fn(), onSpawnBook },
    );
    expect(evilBook.ok).toBe(false);

    const tagRes = await executeTheonTool(
      'spawn_tag',
      { label: 'Bảng công thức', open_formula: true },
      { onSetExpression: vi.fn(), onSpawnTag },
    );
    expect(tagRes.ok).toBe(true);
    expect(onSpawnTag).toHaveBeenCalledWith(
      expect.objectContaining({
        actionMeta: expect.objectContaining({ kind: 'formula' }),
      }),
    );
  });

  it('validates JSON and opens Exercise Tab + spawns Exercise 3D tag via open_exercise_tab', async () => {
    const onOpenExerciseTab = vi.fn(() => ({ tabId: 'tab-ex-1', title: 'Ôn pH' }));
    const onSpawnTag = vi.fn();

    const ok = await executeTheonTool(
      'open_exercise_tab',
      {
        title: 'Ôn pH nhanh',
        time_limit_sec: 120,
        also_spawn_tag: true,
        items: [
          {
            type: 'mcq',
            question: 'pH của HCl 0.01 M là bao nhiêu?',
            options: [{ text: '1' }, { text: '2' }],
            answer: 1,
          },
          {
            type: 'numeric',
            prompt: 'Tính pOH khi pH = 3.5 ở 25°C',
            answer: 10.5,
            tolerance: 0.05,
            unit: 'pOH',
          },
        ],
      },
      { onSetExpression: vi.fn(), onOpenExerciseTab, onSpawnTag },
    );

    expect(ok.ok).toBe(true);
    expect(onOpenExerciseTab).toHaveBeenCalledTimes(1);
    expect(onSpawnTag).toHaveBeenCalledWith(
      expect.objectContaining({
        actionMeta: expect.objectContaining({ kind: 'exercise' }),
      }),
    );

    // Out-of-bounds MCQ answer must fail Zod validation
    const invalid = await executeTheonTool(
      'open_exercise_tab',
      {
        title: 'Bad',
        items: [{ type: 'mcq', question: 'Q?', options: [{ text: 'A' }, { text: 'B' }], answer: 5 }],
      },
      { onSetExpression: vi.fn(), onOpenExerciseTab },
    );
    expect(invalid.ok).toBe(false);
  });

  it('enforces MCP allowlist strictly', async () => {
    const base = createDefaultTheonSettings();
    expect(getActiveTheonToolSpecs(base).some((t) => t.name === 'call_mcp_tool')).toBe(false);

    const enabled = { ...base, mcpEnabled: true, mcpAllowedTools: ['allowed_tool'] };
    expect(getActiveTheonToolSpecs(enabled).some((t) => t.name === 'call_mcp_tool')).toBe(true);

    const rejected = await executeTheonTool(
      'call_mcp_tool',
      { tool_name: 'not_allowed', arguments: {} },
      { settings: enabled, onSetExpression: vi.fn() },
    );
    expect(rejected.ok).toBe(false);
  });
});

describe('Theon native dock registration & exercise persistence', () => {
  it('registers Theon as a single-instance native app and validates persisted Theon & Exercise tabs', () => {
    const def = findAppDefinition('theon');
    expect(def).toBeDefined();
    expect(def?.kind).toBe('native');
    expect(def?.nativeAppId).toBe('theon');
    expect(def?.allowMultiple).toBe(false);

    const validExercise = ExerciseTabPayloadSchema.parse({
      title: 'Bài tập đệm',
      items: [{ type: 'numeric', prompt: 'pH = ?', answer: 4.76, tolerance: 0.05 }],
    });
    expect(parseExerciseTabPayload(validExercise)?.items).toHaveLength(1);

    const parsed = parsePersistedDockState(
      JSON.stringify({
        version: 1,
        open: true,
        expanded: false,
        splitRatio: 0.5,
        activeTabId: 'tab-theon',
        tabs: [
          { id: 'tab-theon', kind: 'native-app', appId: 'theon', nativeAppId: 'theon', title: 'Theon', icon: '◈', url: '' },
          {
            id: 'tab-ex',
            kind: 'native-app',
            appId: 'exercise',
            nativeAppId: 'exercise',
            exercisePayload: validExercise,
            title: 'Bài tập đệm',
            icon: '✎',
            url: '',
          },
          { id: 'tab-bad-ex', kind: 'native-app', nativeAppId: 'exercise', title: 'No payload', icon: 'x', url: '' },
          { id: 'tab-bad', kind: 'native-app', nativeAppId: 'evil-app', title: 'Bad', icon: 'x', url: '' },
        ],
      }),
    );

    expect(parsed?.tabs).toHaveLength(2);
    expect(parsed?.tabs[0]?.nativeAppId).toBe('theon');
    expect(parsed?.tabs[1]?.nativeAppId).toBe('exercise');
    expect(parsed?.tabs[1]?.exercisePayload?.title).toBe('Bài tập đệm');
  });
});

describe('Theon draw_chart tool & schema conventions', () => {
  it('validates and normalizes dual_axis, pie/donut, scatter, and hide calls', async () => {
    const onDrawChart = vi.fn();

    // 1. Dual-axis chart (bar left + line right)
    const dualRes = await executeTheonTool(
      'draw_chart',
      {
        visible: true,
        chart_type: 'dual_axis',
        title: 'Chuẩn độ CH3COOH',
        x_label: 'V NaOH (mL)',
        y_label: 'pH',
        y2_label: 'dpH/dV',
        labels: ['0', '10', '20', '25'],
        series: [
          { name: 'pH', kind: 'line', axis: 'left', values: [2.9, 4.6, 5.4, 8.7] },
          { name: 'dpH/dV', kind: 'bar', axis: 'right', values: [0.1, 0.08, 0.2, 1.8] },
        ],
      },
      { onSetExpression: vi.fn(), onDrawChart },
    );
    expect(dualRes.ok).toBe(true);
    expect(onDrawChart).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chartType: 'dual_axis',
        yLabel: 'pH',
        y2Label: 'dpH/dV',
        series: [
          expect.objectContaining({ name: 'pH', axis: 'left', kind: 'line' }),
          expect.objectContaining({ name: 'dpH/dV', axis: 'right', kind: 'bar' }),
        ],
      }),
    );

    // 2. Pie chart via slices
    const pieRes = await executeTheonTool(
      'draw_chart',
      {
        visible: true,
        chart_type: 'donut',
        title: 'Thành phần dung dịch',
        slices: [
          { label: 'Nước', value: 75 },
          { label: 'Ethanol', value: 25 },
        ],
      },
      { onSetExpression: vi.fn(), onDrawChart },
    );
    expect(pieRes.ok).toBe(true);
    const donutArg = onDrawChart.mock.calls.at(-1)?.[0];
    expect(donutArg?.slices).toHaveLength(2);
    expect(donutArg?.slices[0]?.percent).toBeCloseTo(75);

    // 3. Scatter chart via numeric points
    const scatterRes = await executeTheonTool(
      'draw_chart',
      {
        visible: true,
        chart_type: 'scatter',
        title: 'Đường chuẩn hấp thụ quang',
        series: [{ name: 'Mẫu đo', points: [{ x: 0.1, y: 0.12 }, { x: 0.2, y: 0.25 }] }],
      },
      { onSetExpression: vi.fn(), onDrawChart },
    );
    expect(scatterRes.ok).toBe(true);

    // 4. Hide chart cleanly
    const hideRes = await executeTheonTool(
      'draw_chart',
      { visible: false },
      { onSetExpression: vi.fn(), onDrawChart },
    );
    expect(hideRes.ok).toBe(true);
    expect(onDrawChart).toHaveBeenLastCalledWith(null);

    // 5. Reject missing data when visible = true
    const badRes = await executeTheonTool(
      'draw_chart',
      { visible: true, chart_type: 'bar', title: 'Rỗng' },
      { onSetExpression: vi.fn(), onDrawChart },
    );
    expect(badRes.ok).toBe(false);
  });

  it('validates and normalizes mathematical number_line charts (intervals, rays, points)', async () => {
    const onDrawChart = vi.fn();

    const nlRes = await executeTheonTool(
      'draw_chart',
      {
        visible: true,
        chart_type: 'number_line',
        title: 'Tập nghiệm bất phương trình',
        number_line: {
          axis_label: 'x',
          expression: 'S = (-∞; -2) ∪ [3; +∞)',
          notation: 'both',
          hatch_excluded: true,
          intervals: [
            { from: null, to: -2, include_to: false, label: 'x < -2' },
            { from: 5, to: 3, include_from: true, include_to: false }, // reversed bounds -> auto-swapped
          ],
          points: [{ value: 1, filled: false, label: 'x ≠ 1' }],
        },
      },
      { onSetExpression: vi.fn(), onDrawChart },
    );

    expect(nlRes.ok).toBe(true);
    const spec = onDrawChart.mock.calls.at(-1)?.[0];
    expect(spec?.chartType).toBe('number_line');
    expect(spec?.subtitle).toBe('S = (-∞; -2) ∪ [3; +∞)');
    expect(spec?.numberLine?.intervals).toHaveLength(2);
    expect(spec?.numberLine?.intervals[0]?.from).toBeNull();
    expect(spec?.numberLine?.intervals[0]?.to).toBe(-2);
    expect(spec?.numberLine?.intervals[0]?.includeTo).toBe(false);
    // Reversed [5, 3) -> normalized to (3, 5]
    expect(spec?.numberLine?.intervals[1]?.from).toBe(3);
    expect(spec?.numberLine?.intervals[1]?.to).toBe(5);
    expect(spec?.numberLine?.intervals[1]?.includeFrom).toBe(false);
    expect(spec?.numberLine?.intervals[1]?.includeTo).toBe(true);
    expect(spec?.numberLine?.points[0]?.value).toBe(1);
    expect(spec?.numberLine?.points[0]?.filled).toBe(false);
    expect(spec?.numberLine?.min).toBeLessThan(-2);
    expect(spec?.numberLine?.max).toBeGreaterThan(5);

    // Reject empty number_line (no intervals and no points)
    const emptyNl = await executeTheonTool(
      'draw_chart',
      { visible: true, chart_type: 'number_line', number_line: { intervals: [], points: [] } },
      { onSetExpression: vi.fn(), onDrawChart },
    );
    expect(emptyNl.ok).toBe(false);
  });
});

describe('Theon reply formatter & speech cleaner', () => {
  it('normalizes \\[...\\] and \\(...\\) LaTeX delimiters while leaving code blocks untouched', () => {
    const raw = [
      'Nghiệm phương trình là \\(x = \\frac{-b \\pm \\sqrt{\\Delta}}{2a}\\).',
      '\\[S = (-\\infty; -2) \\cup [3; +\\infty)\\]',
      '```tex',
      '\\(keep_inside_code\\)',
      '```',
    ].join('\n');

    const normalized = normalizeAiMarkdown(raw);
    expect(normalized).toContain('$x = \\frac{-b \\pm \\sqrt{\\Delta}}{2a}$');
    expect(normalized).toContain('$$\nS = (-\\infty; -2) \\cup [3; +\\infty)\n$$');
    expect(normalized).toContain('\\(keep_inside_code\\)');
  });

  it('cleans Markdown and LaTeX into natural spoken Vietnamese for TTS', () => {
    const spoken = stripFormattingForSpeech(
      '**Kết quả:** $x \\ge \\frac{1}{2}$ và $x^2 \\ne 4$ xem [Bài 1](#/toan/ch1/u1).',
    );
    expect(spoken).not.toContain('$');
    expect(spoken).not.toContain('**');
    expect(spoken).not.toContain('#/toan');
    expect(spoken).toContain('lớn hơn hoặc bằng');
    expect(spoken).toContain('1 phần 2');
    expect(spoken).toContain('bình phương');
    expect(spoken).toContain('khác');
  });
});

describe('Theon Voice & AI TTS utilities', () => {
  it('migrates legacy settings seamlessly with voice & TTS defaults', () => {
    const parsed = parseTheonSettings(JSON.stringify({ provider: 'google', model: 'gemini-2.5-flash' }));
    expect(parsed.ttsProvider).toBe('auto');
    expect(parsed.ttsAutoSpeakText).toBe(false);
    expect(parsed.sttProvider).toBe('browser');
    expect(parsed.voiceLang).toBe('vi-VN');
    expect(parsed.voiceContinuous).toBe(true);
  });

  it('encodes raw PCM16 samples with a valid 44-byte RIFF/WAVE header', () => {
    const pcm = new Uint8Array([0, 0, 127, 0, 128, 255, 0, 0]);
    const wav = pcm16ToWavBytes(pcm, 24000, 1);
    expect(wav.byteLength).toBe(44 + pcm.byteLength);
    expect(String.fromCharCode(wav[0] ?? 0, wav[1] ?? 0, wav[2] ?? 0, wav[3] ?? 0)).toBe('RIFF');
    expect(String.fromCharCode(wav[8] ?? 0, wav[9] ?? 0, wav[10] ?? 0, wav[11] ?? 0)).toBe('WAVE');
    const view = new DataView(wav.buffer);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(40, true)).toBe(pcm.byteLength);
  });

  it('resolves OpenAI-compatible TTS endpoint from base or chat completion URLs', () => {
    expect(resolveOpenAiTtsEndpoint('https://api.example.com/v1')).toBe('https://api.example.com/v1/audio/speech');
    expect(resolveOpenAiTtsEndpoint('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/audio/speech',
    );
    expect(resolveOpenAiTtsEndpoint('https://api.example.com/v1/audio/speech')).toBe(
      'https://api.example.com/v1/audio/speech',
    );
  });
});

