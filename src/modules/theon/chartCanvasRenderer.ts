/**
 * High-DPI Holographic Matrix Canvas 2D chart renderer for Theon's
 * screen-flush 3D projection plane.
 */
import { computeNiceBounds, type NormalizedChartSpec } from './chartSchema';

const TYPE_BADGES: Record<NormalizedChartSpec['chartType'], string> = {
  line: 'LINE',
  bar: 'BAR',
  dual_axis: 'DUAL AXIS',
  pie: 'PIE',
  donut: 'DONUT',
  scatter: 'SCATTER',
  area: 'AREA',
};

function formatTick(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 10_000) return `${(val / 1_000).toFixed(1)}k`;
  if (Number.isInteger(val)) return String(val);
  return Math.abs(val) < 1 ? val.toFixed(2) : val.toFixed(1);
}

function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) || 96;
  const g = parseInt(full.slice(2, 4), 16) || 165;
  const b = parseInt(full.slice(4, 6), 16) || 250;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawFrameAndHeader(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  spec: NormalizedChartSpec,
): number {
  // Translucent dark-glass hologram surface so Theon remains subtly visible behind
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(3, 11, 26, 0.90)');
  bg.addColorStop(1, 'rgba(2, 7, 18, 0.94)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle scanline texture
  ctx.fillStyle = 'rgba(59, 130, 246, 0.035)';
  for (let y = 0; y < H; y += 6) {
    ctx.fillRect(0, y, W, 1);
  }

  // Glowing outer frame + precision corner brackets
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  const corner = 24;
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 4;
  ctx.beginPath();
  // Top-left
  ctx.moveTo(4, corner);
  ctx.lineTo(4, 4);
  ctx.lineTo(corner, 4);
  // Top-right
  ctx.moveTo(W - corner, 4);
  ctx.lineTo(W - 4, 4);
  ctx.lineTo(W - 4, corner);
  // Bottom-left
  ctx.moveTo(4, H - corner);
  ctx.lineTo(4, H - 4);
  ctx.lineTo(corner, H - 4);
  // Bottom-right
  ctx.moveTo(W - corner, H - 4);
  ctx.lineTo(W - 4, H - 4);
  ctx.lineTo(W - 4, H - corner);
  ctx.stroke();

  // Header band
  const headerH = spec.subtitle ? 84 : 66;
  ctx.fillStyle = 'rgba(15, 38, 82, 0.55)';
  ctx.fillRect(6, 6, W - 12, headerH);
  ctx.fillStyle = 'rgba(96, 165, 250, 0.55)';
  ctx.fillRect(6, 6 + headerH, W - 12, 2);

  // Chart type pill
  const badgeText = TYPE_BADGES[spec.chartType] ?? 'CHART';
  ctx.font = '700 15px "JetBrains Mono", ui-monospace, monospace';
  const badgeW = ctx.measureText(badgeText).width + 24;
  ctx.fillStyle = 'rgba(37, 99, 235, 0.45)';
  ctx.fillRect(W - badgeW - 24, 22, badgeW, 30);
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(W - badgeW - 24, 22, badgeW, 30);
  ctx.fillStyle = '#dbeafe';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, W - badgeW / 2 - 24, 37);

  // Title & subtitle
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f1f5f9';
  ctx.font = '700 26px "Inter", system-ui, sans-serif';
  ctx.fillText(spec.title.slice(0, 56), 28, 44);

  if (spec.subtitle) {
    ctx.fillStyle = '#93c5fd';
    ctx.font = '500 16px "Inter", system-ui, sans-serif';
    ctx.fillText(spec.subtitle.slice(0, 86), 28, 72);
  }

  return 6 + headerH + 12;
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  W: number,
  topY: number,
  items: Array<{ label: string; color: string; suffix?: string }>,
): number {
  if (!items.length) return topY;
  ctx.font = '600 16px "Inter", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  let x = 28;
  let y = topY + 12;
  const maxX = W - 28;

  for (const item of items) {
    const label = item.suffix ? `${item.label} (${item.suffix})` : item.label;
    const width = 20 + ctx.measureText(label).width + 26;
    if (x + width > maxX && x > 28) {
      x = 28;
      y += 28;
    }
    ctx.fillStyle = item.color;
    ctx.fillRect(x, y - 6, 12, 12);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(label, x + 18, y);
    x += width;
  }

  return y + 26;
}

function renderPieOrDonut(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  contentTop: number,
  spec: NormalizedChartSpec,
) {
  const slices = spec.slices;
  if (!slices.length) return;

  const isDonut = spec.chartType === 'donut';
  const availH = H - contentTop - 28;
  const radius = Math.max(70, Math.min(availH * 0.43, W * 0.23));
  const cx = W * 0.34;
  const cy = contentTop + availH * 0.50;

  let startAngle = -Math.PI / 2;
  for (const slice of slices) {
    const sweep = (slice.percent / 100) * Math.PI * 2;
    const endAngle = startAngle + sweep;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = withAlpha(slice.color, 0.88);
    ctx.fill();
    ctx.strokeStyle = '#020817';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Percentage label on large enough slices
    if (spec.showValues && slice.percent >= 7) {
      const mid = startAngle + sweep / 2;
      const lr = isDonut ? radius * 0.76 : radius * 0.64;
      const lx = cx + Math.cos(mid) * lr;
      const ly = cy + Math.sin(mid) * lr;
      ctx.fillStyle = '#020617';
      ctx.font = '700 16px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${slice.percent.toFixed(1)}%`, lx, ly);
    }

    startAngle = endAngle;
  }

  // Outer glowing hologram ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (isDonut) {
    const innerR = radius * 0.52;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fillStyle = '#030b1a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const total = slices.reduce((sum, s) => sum + s.value, 0);
    ctx.fillStyle = '#93c5fd';
    ctx.font = '600 14px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TỔNG', cx, cy - 14);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 24px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(formatTick(total), cx, cy + 14);
  }

  // Right-side breakdown legend
  const listX = W * 0.62;
  const maxListW = W - listX - 28;
  const rowH = Math.min(44, Math.max(28, (availH - 16) / Math.max(slices.length, 1)));
  let ly = contentTop + Math.max(16, (availH - slices.length * rowH) * 0.5);

  ctx.textBaseline = 'middle';
  for (const slice of slices) {
    ctx.fillStyle = slice.color;
    ctx.fillRect(listX, ly - 8, 14, 16);

    ctx.fillStyle = '#f1f5f9';
    ctx.font = '600 18px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(slice.label.slice(0, 22), listX + 24, ly);

    ctx.fillStyle = '#93c5fd';
    ctx.font = '700 16px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${formatTick(slice.value)} (${slice.percent.toFixed(1)}%)`, listX + maxListW, ly);

    ly += rowH;
  }
}

function renderCartesianChart(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  contentTop: number,
  spec: NormalizedChartSpec,
) {
  const hasRightAxis = spec.chartType === 'dual_axis' || spec.series.some((s) => s.axis === 'right');
  const legendTop = drawLegend(
    ctx,
    W,
    contentTop,
    spec.series.map((s) => ({
      label: s.name,
      color: s.color,
      suffix: hasRightAxis ? (s.axis === 'right' ? 'Trục phải' : 'Trục trái') : undefined,
    })),
  );

  const padL = spec.yLabel ? 98 : 78;
  const padR = hasRightAxis ? (spec.y2Label ? 98 : 78) : 34;
  const padT = legendTop + 10;
  const padB = spec.xLabel ? 78 : 54;
  const plotW = Math.max(120, W - padL - padR);
  const plotH = Math.max(120, H - padT - padB);

  const isNumericX =
    spec.chartType === 'scatter' ||
    spec.series.some((s) => s.points.length > 0 && s.values.length === 0);

  const leftSeries = spec.series.filter((s) => s.axis !== 'right');
  const rightSeries = spec.series.filter((s) => s.axis === 'right');

  const collectY = (list: NormalizedChartSpec['series']) =>
    list.flatMap((s) => (s.points.length > 0 ? s.points.map((p) => p.y) : s.values));

  const leftHasBar = leftSeries.some((s) => s.kind === 'bar');
  const rightHasBar = rightSeries.some((s) => s.kind === 'bar');

  const leftBounds = computeNiceBounds(collectY(leftSeries), leftHasBar);
  const rightBounds = hasRightAxis ? computeNiceBounds(collectY(rightSeries), rightHasBar) : null;

  const xPointsAll = isNumericX ? spec.series.flatMap((s) => s.points.map((p) => p.x)) : [];
  const xBounds = isNumericX ? computeNiceBounds(xPointsAll, false) : null;

  const mapYLeft = (v: number) =>
    padT + plotH - ((v - leftBounds.min) / Math.max(leftBounds.max - leftBounds.min, 1e-9)) * plotH;
  const mapYRight = (v: number) => {
    if (!rightBounds) return mapYLeft(v);
    return (
      padT +
      plotH -
      ((v - rightBounds.min) / Math.max(rightBounds.max - rightBounds.min, 1e-9)) * plotH
    );
  };

  // Grid & Left Y ticks
  ctx.font = '600 15px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  for (const tick of leftBounds.ticks) {
    const py = mapYLeft(tick);
    if (spec.showGrid) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, py);
      ctx.lineTo(padL + plotW, py);
      ctx.stroke();
    }
    ctx.fillStyle = leftSeries[0]?.color ?? '#93c5fd';
    ctx.textAlign = 'right';
    ctx.fillText(formatTick(tick), padL - 12, py);
  }

  // Right Y ticks (for dual_axis)
  if (hasRightAxis && rightBounds) {
    for (const tick of rightBounds.ticks) {
      const py = mapYRight(tick);
      ctx.fillStyle = rightSeries[0]?.color ?? '#34d399';
      ctx.textAlign = 'left';
      ctx.fillText(formatTick(tick), padL + plotW + 12, py);
    }
  }

  // Axes border lines
  ctx.strokeStyle = 'rgba(147, 197, 253, 0.65)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  if (hasRightAxis) {
    ctx.moveTo(padL + plotW, padT);
    ctx.lineTo(padL + plotW, padT + plotH);
  }
  ctx.stroke();

  // X ticks & vertical grid
  if (isNumericX && xBounds) {
    for (const tick of xBounds.ticks) {
      const px =
        padL + ((tick - xBounds.min) / Math.max(xBounds.max - xBounds.min, 1e-9)) * plotW;
      if (spec.showGrid) {
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, padT);
        ctx.lineTo(px, padT + plotH);
        ctx.stroke();
      }
      ctx.fillStyle = '#cbd5e1';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(formatTick(tick), px, padT + plotH + 10);
    }
  } else {
    const count = Math.max(1, spec.labels.length);
    const step = count > 12 ? Math.ceil(count / 10) : 1;
    const useSlotCenter = spec.series.some((s) => s.kind === 'bar') || count === 1;
    for (let i = 0; i < count; i += step) {
      const px = useSlotCenter
        ? padL + ((i + 0.5) / count) * plotW
        : padL + (i / Math.max(1, count - 1)) * plotW;
      ctx.fillStyle = '#cbd5e1';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText((spec.labels[i] ?? '').slice(0, 14), px, padT + plotH + 10);
    }
  }

  // Axis labels
  ctx.font = '600 16px "Inter", system-ui, sans-serif';
  if (spec.xLabel) {
    ctx.fillStyle = '#93c5fd';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(spec.xLabel, padL + plotW / 2, H - 14);
  }
  if (spec.yLabel) {
    ctx.save();
    ctx.translate(22, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = leftSeries[0]?.color ?? '#93c5fd';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(spec.yLabel, 0, 0);
    ctx.restore();
  }
  if (hasRightAxis && spec.y2Label) {
    ctx.save();
    ctx.translate(W - 22, padT + plotH / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = rightSeries[0]?.color ?? '#34d399';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(spec.y2Label, 0, 0);
    ctx.restore();
  }

  // Draw bar series first (so lines/scatter appear crisply on top!)
  const barSeries = spec.series.filter((s) => s.kind === 'bar');
  const count = Math.max(1, spec.labels.length);
  const slotW = plotW / count;
  if (barSeries.length > 0) {
    const groupW = slotW * 0.72;
    const singleW = Math.max(6, groupW / barSeries.length - 4);
    barSeries.forEach((s, bIdx) => {
      const mapY = s.axis === 'right' ? mapYRight : mapYLeft;
      const zeroY = Math.min(padT + plotH, Math.max(padT, mapY(0)));
      s.values.forEach((val, i) => {
        const slotLeft = padL + i * slotW + (slotW - groupW) * 0.5;
        const bx = slotLeft + bIdx * (singleW + 4);
        const by = mapY(val);
        const top = Math.min(by, zeroY);
        const bh = Math.max(2, Math.abs(zeroY - by));

        const grad = ctx.createLinearGradient(0, top, 0, top + bh);
        grad.addColorStop(0, withAlpha(s.color, 0.92));
        grad.addColorStop(1, withAlpha(s.color, 0.38));
        ctx.fillStyle = grad;
        ctx.fillRect(bx, top, singleW, bh);

        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, top, singleW, bh);

        if (spec.showValues && count <= 10) {
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '700 13px "JetBrains Mono", ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(formatTick(val), bx + singleW / 2, top - 4);
        }
      });
    });
  }

  // Draw area, line, and scatter series
  const hasBars = barSeries.length > 0;
  for (const s of spec.series) {
    if (s.kind === 'bar') continue;
    const mapY = s.axis === 'right' ? mapYRight : mapYLeft;

    const coords: Array<{ px: number; py: number; val: number }> = [];
    if (s.points.length > 0 && xBounds) {
      for (const p of s.points) {
        const px =
          padL + ((p.x - xBounds.min) / Math.max(xBounds.max - xBounds.min, 1e-9)) * plotW;
        coords.push({ px, py: mapY(p.y), val: p.y });
      }
    } else {
      const n = s.values.length;
      for (let i = 0; i < n; i++) {
        const px =
          hasBars || count === 1
            ? padL + ((i + 0.5) / count) * plotW
            : padL + (i / Math.max(1, count - 1)) * plotW;
        coords.push({ px, py: mapY(s.values[i]!), val: s.values[i]! });
      }
    }

    if (!coords.length) continue;

    if (s.kind === 'area' && coords.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(coords[0]!.px, padT + plotH);
      for (const pt of coords) ctx.lineTo(pt.px, pt.py);
      ctx.lineTo(coords[coords.length - 1]!.px, padT + plotH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, withAlpha(s.color, 0.42));
      grad.addColorStop(1, withAlpha(s.color, 0.04));
      ctx.fillStyle = grad;
      ctx.fill();
    }

    if ((s.kind === 'line' || s.kind === 'area') && coords.length >= 2) {
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3.5;
      ctx.shadowColor = withAlpha(s.color, 0.65);
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(coords[0]!.px, coords[0]!.py);
      for (let i = 1; i < coords.length; i++) {
        ctx.lineTo(coords[i]!.px, coords[i]!.py);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Points / markers
    const showDots = s.kind === 'scatter' || coords.length <= 24;
    if (showDots) {
      const r = s.kind === 'scatter' ? 6 : 4.5;
      for (const pt of coords) {
        ctx.beginPath();
        ctx.arc(pt.px, pt.py, r, 0, Math.PI * 2);
        ctx.fillStyle = '#020817';
        ctx.fill();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }
  }
}

/**
 * Renders any NormalizedChartSpec onto a 2D canvas ready to become a Three.js
 * CanvasTexture on Theon's screen-flush hologram plane.
 */
export function renderChartToCanvas(
  canvas: HTMLCanvasElement,
  spec: NormalizedChartSpec,
  width = 1280,
  height = 760,
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, width, height);
  const contentTop = drawFrameAndHeader(ctx, width, height, spec);

  if (spec.chartType === 'pie' || spec.chartType === 'donut') {
    renderPieOrDonut(ctx, width, height, contentTop, spec);
  } else {
    renderCartesianChart(ctx, width, height, contentTop, spec);
  }
}
