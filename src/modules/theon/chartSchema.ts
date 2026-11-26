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

export function normalizeChartSpec(args: DrawChartArgs): NormalizedChartSpec | null {
  if (!args.visible || !args.chart_type) return null;

  const chartType = args.chart_type;
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
