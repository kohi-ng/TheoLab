/**
 * Standardized Zod 4 schema & normalization helpers for Theon's screen-flush
 * Matrix Hologram Chart tool (`draw_chart`).
 *
 * Supported chart types:
 * - `line`: single or multi-series line chart (categorical `labels` or numeric `points`)
 * - `area`: filled translucent area chart
 * - `bar`: grouped/single vertical bar chart
 * - `dual_axis`: two Y-axes (`axis: 'left'` and `axis: 'right'`), mixing bar/line/area freely
 * - `pie` / `donut`: proportional circular charts (accepts `slices` OR `labels` + `series[0].values`)
 * - `scatter`: numeric (x, y) point plot with optional trend line
 * - `number_line`: mathematical real number line with intervals, rays (-∞/+∞), points, brackets/circles, and excluded-region hatching
 */
import { z } from 'zod';

export const CHART_TYPES = [
  'line',
  'bar',
  'dual_axis',
  'pie',
  'donut',
  'scatter',
  'area',
  'number_line',
] as const;

export type TheonChartType = (typeof CHART_TYPES)[number];

export const DEFAULT_CHART_PALETTE = Object.freeze([
  '#60a5fa', // electric sky blue
  '#34d399', // matrix emerald
  '#a78bfa', // soft violet
  '#fbbf24', // warm amber
  '#f472b6', // rose glow
  '#38bdf8', // bright cyan
]);

const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{3,8}$/, 'Màu phải là mã hex hợp lệ (VD: #60a5fa)')
  .optional();

export const ChartPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  label: z.string().max(40).optional(),
});

export const ChartSeriesSchema = z.object({
  name: z.string().min(1).max(60),
  kind: z.enum(['line', 'bar', 'area', 'scatter']).optional(),
  axis: z.enum(['left', 'right']).default('left'),
  color: HexColorSchema,
  values: z.array(z.number().finite()).max(120).optional(),
  points: z.array(ChartPointSchema).max(200).optional(),
});

export const ChartSliceSchema = z.object({
  label: z.string().min(1).max(60),
  value: z.number().finite().nonnegative(),
  color: HexColorSchema,
});

export const NumberLineIntervalSchema = z.object({
  /** `null` or omitted means -∞ (unbounded left ray). */
  from: z.number().finite().nullable().optional(),
  /** `null` or omitted means +∞ (unbounded right ray). */
  to: z.number().finite().nullable().optional(),
  include_from: z.boolean().optional(),
  include_to: z.boolean().optional(),
  from_inclusive: z.boolean().optional(),
  to_inclusive: z.boolean().optional(),
  label: z.string().max(48).optional(),
  color: HexColorSchema,
  style: z.enum(['solution', 'excluded']).default('solution'),
});

export const NumberLinePointSchema = z.object({
  value: z.number().finite(),
  label: z.string().max(32).optional(),
  filled: z.boolean().default(true),
  color: HexColorSchema,
});

export const NumberLineConfigSchema = z.object({
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  axis_label: z.string().max(24).optional(),
  expression: z.string().max(120).optional(),
  intervals: z.array(NumberLineIntervalSchema).max(12).default([]),
  points: z.array(NumberLinePointSchema).max(24).default([]),
  hatch_excluded: z.boolean().default(true),
  notation: z.enum(['bracket', 'circle', 'both']).default('both'),
});

export const DrawChartArgsSchema = z
  .object({
    visible: z.boolean().default(true),
    chart_type: z.enum(CHART_TYPES).optional(),
    title: z.string().max(90).optional(),
    subtitle: z.string().max(140).optional(),
    x_label: z.string().max(60).optional(),
    y_label: z.string().max(60).optional(),
    y2_label: z.string().max(60).optional(),
    labels: z.array(z.string().max(40)).max(120).optional(),
    series: z.array(ChartSeriesSchema).max(6).optional(),
    slices: z.array(ChartSliceSchema).max(16).optional(),
    number_line: NumberLineConfigSchema.optional(),
    show_grid: z.boolean().default(true),
    show_values: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.visible) return;
    if (!data.chart_type) {
      ctx.addIssue({
        code: 'custom',
        path: ['chart_type'],
        message: 'Cần chỉ định chart_type khi visible = true.',
      });
      return;
    }

    if (data.chart_type === 'number_line') {
      const nl = data.number_line;
      const hasContent =
        Boolean(nl) &&
        ((nl!.intervals?.length ?? 0) > 0 ||
          (nl!.points?.length ?? 0) > 0 ||
          (typeof nl!.min === 'number' && typeof nl!.max === 'number' && nl!.max > nl!.min));
      if (!hasContent) {
        ctx.addIssue({
          code: 'custom',
          path: ['number_line'],
          message: 'Đồ thị trục số (`number_line`) cần ít nhất 1 khoảng (`intervals`), điểm (`points`), hoặc cặp `min`/`max`.',
        });
      }
      return;
    }

    if (data.chart_type === 'pie' || data.chart_type === 'donut') {
      const hasSlices = Array.isArray(data.slices) && data.slices.some((s) => s.value > 0);
      const hasSeries =
        Array.isArray(data.series) &&
        data.series.length > 0 &&
        Array.isArray(data.series[0]?.values) &&
        data.series[0].values.some((v) => v > 0);
      if (!hasSlices && !hasSeries) {
        ctx.addIssue({
          code: 'custom',
          path: ['slices'],
          message: 'Biểu đồ tròn/vành khuyên cần `slices` (hoặc `labels` + `series[0].values`) có giá trị > 0.',
        });
      }
      return;
    }

    const hasSeriesData =
      Array.isArray(data.series) &&
      data.series.some(
        (s) =>
          (Array.isArray(s.values) && s.values.length > 0) ||
          (Array.isArray(s.points) && s.points.length > 0),
      );
    if (!hasSeriesData) {
      ctx.addIssue({
        code: 'custom',
        path: ['series'],
        message: 'Biểu đồ cần ít nhất 1 chuỗi trong `series` chứa `values` hoặc `points`.',
      });
    }
  });

export type DrawChartArgs = z.infer<typeof DrawChartArgsSchema>;
export type ChartSeries = z.infer<typeof ChartSeriesSchema>;
export type ChartSlice = z.infer<typeof ChartSliceSchema>;
export type NumberLineIntervalInput = z.infer<typeof NumberLineIntervalSchema>;
export type NumberLinePointInput = z.infer<typeof NumberLinePointSchema>;

export interface NormalizedChartSlice {
  label: string;
  value: number;
  color: string;
  percent: number;
}

export interface NormalizedChartSeries {
  name: string;
  kind: 'line' | 'bar' | 'area' | 'scatter';
  axis: 'left' | 'right';
  color: string;
  values: number[];
  points: Array<{ x: number; y: number; label?: string }>;
}

export interface NormalizedNumberLineInterval {
  from: number | null;
  to: number | null;
  includeFrom: boolean;
  includeTo: boolean;
  label: string;
  color: string;
  style: 'solution' | 'excluded';
}

export interface NormalizedNumberLinePoint {
  value: number;
  label: string;
  filled: boolean;
  color: string;
}

export interface NormalizedNumberLine {
  min: number;
  max: number;
  ticks: number[];
  axisLabel: string;
  intervals: NormalizedNumberLineInterval[];
  points: NormalizedNumberLinePoint[];
  hatchExcluded: boolean;
  notation: 'bracket' | 'circle' | 'both';
}

export interface NormalizedChartSpec {
  chartType: TheonChartType;
  title: string;
  subtitle: string;
  xLabel: string;
  yLabel: string;
  y2Label: string;
  labels: string[];
  series: NormalizedChartSeries[];
  slices: NormalizedChartSlice[];
  numberLine?: NormalizedNumberLine;
  showGrid: boolean;
  showValues: boolean;
}

export function computeNiceBounds(values: number[], includeZero = false): {
  min: number;
  max: number;
  ticks: number[];
} {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) {
    return { min: 0, max: 10, ticks: [0, 2.5, 5, 7.5, 10] };
  }

  let minVal = Math.min(...finite);
  let maxVal = Math.max(...finite);
  if (includeZero) {
    minVal = Math.min(0, minVal);
    maxVal = Math.max(0, maxVal);
  }
  if (Math.abs(maxVal - minVal) < 1e-9) {
    const pad = Math.abs(maxVal) > 0 ? Math.abs(maxVal) * 0.2 : 1;
    minVal -= pad;
    maxVal += pad;
  }

  const rawRange = maxVal - minVal;
  const roughStep = rawRange / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / mag;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = niceNorm * mag;

  const min = Math.floor(minVal / step) * step;
  const max = Math.ceil(maxVal / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step * 0.25; v += step) {
    ticks.push(Number(v.toFixed(6)));
    if (ticks.length > 8) break;
  }
  return { min, max, ticks };
}

function normalizeNumberLine(
  input: z.infer<typeof NumberLineConfigSchema>,
  fallbackAxisLabel?: string,
): NormalizedNumberLine {
  const intervals: NormalizedNumberLineInterval[] = (input.intervals ?? []).map((iv, idx) => {
    let from = iv.from ?? null;
    let to = iv.to ?? null;
    let includeFrom = Boolean(iv.include_from ?? iv.from_inclusive ?? false);
    let includeTo = Boolean(iv.include_to ?? iv.to_inclusive ?? false);
    if (from !== null && to !== null && from > to) {
      [from, to] = [to, from];
      [includeFrom, includeTo] = [includeTo, includeFrom];
    }
    return {
      from,
      to,
      includeFrom,
      includeTo,
      label: iv.label?.trim() || '',
      color:
        iv.color ||
        (iv.style === 'excluded'
          ? '#f87171'
          : DEFAULT_CHART_PALETTE[idx % DEFAULT_CHART_PALETTE.length]!),
      style: iv.style ?? 'solution',
    };
  });

  const points: NormalizedNumberLinePoint[] = (input.points ?? []).map((pt, idx) => ({
    value: pt.value,
    label: pt.label?.trim() || '',
    filled: pt.filled ?? true,
    color: pt.color || DEFAULT_CHART_PALETTE[(idx + 1) % DEFAULT_CHART_PALETTE.length]!,
  }));

  const anchors: number[] = [];
  for (const iv of intervals) {
    if (iv.from !== null) anchors.push(iv.from);
    if (iv.to !== null) anchors.push(iv.to);
  }
  for (const pt of points) anchors.push(pt.value);
  if (typeof input.min === 'number') anchors.push(input.min);
  if (typeof input.max === 'number') anchors.push(input.max);

  const finite = anchors.filter((v) => Number.isFinite(v));
  let rawMin = finite.length ? Math.min(...finite) : -5;
  let rawMax = finite.length ? Math.max(...finite) : 5;

  if (Math.abs(rawMax - rawMin) < 1e-9) {
    rawMin -= 3;
    rawMax += 3;
  } else {
    const pad = Math.max(1, (rawMax - rawMin) * 0.24);
    if (input.min === undefined) rawMin -= pad;
    if (input.max === undefined) rawMax += pad;
  }

  let min = input.min ?? Math.floor(rawMin);
  let max = input.max ?? Math.ceil(rawMax);
  if (max <= min) {
    min -= 2;
    max += 2;
  }

  let ticks: number[] = [];
  if (input.step && input.step > 0) {
    const start = Math.ceil(min / input.step) * input.step;
    for (let v = start; v <= max + input.step * 0.05 && ticks.length < 16; v += input.step) {
      ticks.push(Number(v.toFixed(6)));
    }
  } else {
    const range = max - min;
    const rough = range / 8;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    const step = nice * mag;
    const start = Math.ceil(min / step) * step;
    for (let v = start; v <= max + step * 0.05 && ticks.length < 16; v += step) {
      ticks.push(Number(v.toFixed(6)));
    }
  }

  return {
    min,
    max,
    ticks,
    axisLabel: input.axis_label?.trim() || fallbackAxisLabel?.trim() || 'x',
    intervals,
    points,
    hatchExcluded: input.hatch_excluded ?? true,
    notation: input.notation ?? 'both',
  };
}

export function normalizeChartSpec(args: DrawChartArgs): NormalizedChartSpec | null {
  if (!args.visible || !args.chart_type) return null;

  const chartType = args.chart_type;
  if (chartType === 'number_line' && args.number_line) {
    return {
      chartType,
      title: args.title?.trim() || 'TRỤC SỐ TOÁN HỌC',
      subtitle: args.subtitle?.trim() || args.number_line.expression?.trim() || '',
      xLabel: args.x_label?.trim() || args.number_line.axis_label?.trim() || 'x',
      yLabel: '',
      y2Label: '',
      labels: [],
      series: [],
      slices: [],
      numberLine: normalizeNumberLine(args.number_line, args.x_label),
      showGrid: args.show_grid ?? true,
      showValues: args.show_values ?? true,
    };
  }

  const rawSeries = args.series ?? [];

  // Normalize slices for pie / donut
  let slices: NormalizedChartSlice[] = [];
  if (chartType === 'pie' || chartType === 'donut') {
    const sourceSlices: Array<{ label: string; value: number; color?: string }> =
      args.slices && args.slices.length > 0
        ? args.slices
        : (rawSeries[0]?.values ?? []).map((val, idx) => ({
            label: args.labels?.[idx] ?? `Mục ${idx + 1}`,
            value: Math.max(0, val),
          }));

    const positive = sourceSlices.filter((s) => Number.isFinite(s.value) && s.value > 0);
    const total = positive.reduce((sum, s) => sum + s.value, 0) || 1;
    slices = positive.map((s, idx) => ({
      label: s.label,
      value: s.value,
      color: s.color || DEFAULT_CHART_PALETTE[idx % DEFAULT_CHART_PALETTE.length]!,
      percent: (s.value / total) * 100,
    }));
  }

  const series: NormalizedChartSeries[] = rawSeries.map((s, idx) => {
    const defaultKind: NormalizedChartSeries['kind'] =
      chartType === 'bar'
        ? 'bar'
        : chartType === 'area'
          ? 'area'
          : chartType === 'scatter'
            ? 'scatter'
            : chartType === 'dual_axis'
              ? idx === 0
                ? 'bar'
                : 'line'
              : 'line';

    const axis: 'left' | 'right' =
      chartType === 'dual_axis' && !rawSeries.some((item) => item.axis === 'right') && idx > 0
        ? 'right'
        : (s.axis ?? 'left');

    return {
      name: s.name,
      kind: s.kind ?? defaultKind,
      axis,
      color: s.color || DEFAULT_CHART_PALETTE[idx % DEFAULT_CHART_PALETTE.length]!,
      values: s.values ?? [],
      points: s.points ?? [],
    };
  });

  const maxLen = Math.max(
    args.labels?.length ?? 0,
    ...series.map((s) => s.values.length),
  );
  const labels =
    args.labels && args.labels.length > 0
      ? args.labels
      : Array.from({ length: maxLen }, (_, i) => String(i + 1));

  return {
    chartType,
    title: args.title?.trim() || 'BIỂU ĐỒ DỮ LIỆU',
    subtitle: args.subtitle?.trim() || '',
    xLabel: args.x_label?.trim() || '',
    yLabel: args.y_label?.trim() || '',
    y2Label: args.y2_label?.trim() || '',
    labels,
    series,
    slices,
    showGrid: args.show_grid ?? true,
    showValues:
      args.show_values ??
      (chartType === 'pie' || chartType === 'donut' || (chartType === 'bar' && labels.length <= 10)),
  };
}
