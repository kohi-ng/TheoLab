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
  number_line: 'TRỤC SỐ',
};

function formatTick(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 10_000) return `${(val / 1_000).toFixed(1)}k`;
  if (Number.isInteger(val)) return String(val);
  return Math.abs(val) < 1 ? Number(val.toFixed(2)).toString() : Number(val.toFixed(2)).toString();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 3 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
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
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(3, 11, 26, 0.92)');
  bg.addColorStop(1, 'rgba(2, 7, 18, 0.96)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(59, 130, 246, 0.035)';
  for (let y = 0; y < H; y += 6) {
    ctx.fillRect(0, y, W, 1);
  }

  ctx.strokeStyle = 'rgba(59, 130, 246, 0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  const corner = 24;
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(4, corner);
  ctx.lineTo(4, 4);
  ctx.lineTo(corner, 4);
  ctx.moveTo(W - corner, 4);
  ctx.lineTo(W - 4, 4);
  ctx.lineTo(W - 4, corner);
  ctx.moveTo(4, H - corner);
  ctx.lineTo(4, H - 4);
  ctx.lineTo(corner, H - 4);
  ctx.moveTo(W - corner, H - 4);
  ctx.lineTo(W - 4, H - 4);
  ctx.lineTo(W - 4, H - corner);
  ctx.stroke();

  const headerH = spec.subtitle ? 84 : 66;
  ctx.fillStyle = 'rgba(15, 38, 82, 0.55)';
  ctx.fillRect(6, 6, W - 12, headerH);
  ctx.fillStyle = 'rgba(96, 165, 250, 0.55)';
  ctx.fillRect(6, 6 + headerH, W - 12, 2);

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

  const maxTitleW = Math.max(160, W - badgeW - 72);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f1f5f9';
  ctx.font = '700 25px "Inter", system-ui, sans-serif';
  ctx.fillText(fitText(ctx, spec.title, maxTitleW), 28, 44);

  if (spec.subtitle) {
    ctx.fillStyle = '#93c5fd';
    ctx.font = '500 16px "Inter", system-ui, sans-serif';
    ctx.fillText(fitText(ctx, spec.subtitle, W - 56), 28, 72);
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
  const stacked = W / H < 1.25;

  const radius = stacked
    ? Math.max(64, Math.min(availH * 0.27, W * 0.30))
    : Math.max(70, Math.min(availH * 0.43, W * 0.23));
  const cx = stacked ? W * 0.5 : W * 0.34;
  const cy = stacked ? contentTop + radius + 24 : contentTop + availH * 0.5;

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

    if (spec.showValues && slice.percent >= 7) {
      const mid = startAngle + sweep / 2;
      const lr = isDonut ? radius * 0.76 : radius * 0.64;
      const lx = cx + Math.cos(mid) * lr;
      const ly = cy + Math.sin(mid) * lr;
      ctx.fillStyle = '#020617';
      ctx.font = '700 15px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${slice.percent.toFixed(1)}%`, lx, ly);
    }

    startAngle = endAngle;
  }

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
    ctx.font = '700 22px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(formatTick(total), cx, cy + 14);
  }

  const listX = stacked ? 36 : W * 0.62;
  const maxListW = stacked ? W - 72 : W - listX - 28;
  const listAvailH = stacked ? H - (cy + radius + 36) - 18 : availH - 16;
  const rowH = Math.min(40, Math.max(24, listAvailH / Math.max(slices.length, 1)));
  let ly = stacked
    ? cy + radius + 36
    : contentTop + Math.max(16, (availH - slices.length * rowH) * 0.5);

  ctx.textBaseline = 'middle';
  for (const slice of slices) {
    if (ly > H - 16) break;
    ctx.fillStyle = slice.color;
    ctx.fillRect(listX, ly - 8, 14, 16);

    ctx.fillStyle = '#f1f5f9';
    ctx.font = '600 17px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, slice.label, maxListW * 0.54), listX + 24, ly);

    ctx.fillStyle = '#93c5fd';
    ctx.font = '700 15px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${formatTick(slice.value)} (${slice.percent.toFixed(1)}%)`, listX + maxListW, ly);

    ly += rowH;
  }
}

function drawHatchBand(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  axisY: number,
  halfH: number,
  color = 'rgba(248, 113, 113, 0.42)',
) {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  if (right - left < 4) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, axisY - halfH, right - left, halfH * 2);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const step = 14;
  for (let x = left - halfH * 2; x <= right + halfH * 2; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, axisY + halfH);
    ctx.lineTo(x + halfH * 2, axisY - halfH);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBracketGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  axisY: number,
  side: 'left' | 'right',
  inclusive: boolean,
  color: string,
) {
  const h = 24;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.shadowColor = withAlpha(color, 0.7);
  ctx.shadowBlur = 10;
  ctx.beginPath();
  if (inclusive) {
    const lip = side === 'left' ? 10 : -10;
    ctx.moveTo(x + lip, axisY - h);
    ctx.lineTo(x, axisY - h);
    ctx.lineTo(x, axisY + h);
    ctx.lineTo(x + lip, axisY + h);
  } else {
    const bulge = side === 'left' ? -10 : 10;
    ctx.moveTo(x + (side === 'left' ? 5 : -5), axisY - h);
    ctx.quadraticCurveTo(x + bulge, axisY, x + (side === 'left' ? 5 : -5), axisY + h);
  }
  ctx.stroke();
  ctx.restore();
}

function renderNumberLineChart(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  contentTop: number,
  spec: NormalizedChartSpec,
) {
  const nl = spec.numberLine;
  if (!nl) return;

  const legendItems: Array<{ label: string; color: string }> = [];
  nl.intervals.forEach((iv, idx) => {
    const leftSym = iv.from === null ? '(−∞' : `${iv.includeFrom ? '[' : '('}${formatTick(iv.from)}`;
    const rightSym = iv.to === null ? '+∞)' : `${formatTick(iv.to)}${iv.includeTo ? ']' : ')'}`;
    legendItems.push({
      label: iv.label || `${iv.style === 'excluded' ? 'Loại: ' : ''}${leftSym}; ${rightSym}`,
      color: iv.color,
    });
    void idx;
  });
  if (nl.hatchExcluded && nl.intervals.some((i) => i.style === 'solution')) {
    legendItems.push({ label: 'Phần bị loại (gạch chéo)', color: '#f87171' });
  }

  const afterLegendY = drawLegend(ctx, W, contentTop, legendItems);

  const padL = 78;
  const padR = 88;
  const lineStart = padL;
  const lineEnd = W - padR;
  const lineW = Math.max(160, lineEnd - lineStart);
  const availH = H - afterLegendY - 36;
  const axisY = afterLegendY + availH * 0.54;

  const span = Math.max(nl.max - nl.min, 1e-9);
  const mapX = (v: number) => lineStart + ((v - nl.min) / span) * lineW;
  const clampX = (px: number) => Math.max(lineStart, Math.min(lineEnd, px));

  // Optional subtle vertical grid at regular ticks
  if (spec.showGrid) {
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.16)';
    ctx.lineWidth = 1;
    for (const tick of nl.ticks) {
      const px = mapX(tick);
      if (px < lineStart + 6 || px > lineEnd - 6) continue;
      ctx.beginPath();
      ctx.moveTo(px, afterLegendY + 18);
      ctx.lineTo(px, H - 46);
      ctx.stroke();
    }
  }

  // Compute complement excluded regions if hatchExcluded is true and solution intervals exist
  const solutionIntervals = nl.intervals.filter((i) => i.style === 'solution');
  const explicitExcluded = nl.intervals.filter((i) => i.style === 'excluded');

  if (nl.hatchExcluded && solutionIntervals.length > 0) {
    // Merge solution ranges in pixel space [lineStart, lineEnd]
    const covered = solutionIntervals
      .map((iv) => ({
        a: iv.from === null ? lineStart : clampX(mapX(iv.from)),
        b: iv.to === null ? lineEnd : clampX(mapX(iv.to)),
      }))
      .sort((u, v) => u.a - v.a);

    const merged: Array<{ a: number; b: number }> = [];
    for (const seg of covered) {
      const prev = merged[merged.length - 1];
      if (prev && seg.a <= prev.b + 1) {
        prev.b = Math.max(prev.b, seg.b);
      } else {
        merged.push({ ...seg });
      }
    }

    let cursor = lineStart;
    for (const seg of merged) {
      if (seg.a > cursor + 2) drawHatchBand(ctx, cursor, seg.a, axisY, 20);
      cursor = Math.max(cursor, seg.b);
    }
    if (cursor < lineEnd - 2) drawHatchBand(ctx, cursor, lineEnd, axisY, 20);
  }

  for (const ex of explicitExcluded) {
    const x1 = ex.from === null ? lineStart : clampX(mapX(ex.from));
    const x2 = ex.to === null ? lineEnd : clampX(mapX(ex.to));
    drawHatchBand(ctx, x1, x2, axisY, 20, withAlpha(ex.color, 0.5));
  }

  // Main real number axis with arrowheads
  ctx.save();
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(lineStart - 16, axisY);
  ctx.lineTo(lineEnd + 22, axisY);
  ctx.stroke();

  // Right arrowhead (+∞)
  ctx.fillStyle = '#93c5fd';
  ctx.beginPath();
  ctx.moveTo(lineEnd + 28, axisY);
  ctx.lineTo(lineEnd + 14, axisY - 8);
  ctx.lineTo(lineEnd + 14, axisY + 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Infinity & axis labels
  ctx.font = '700 18px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = '#93c5fd';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillText('−∞', lineStart - 24, axisY);
  ctx.textAlign = 'left';
  ctx.fillText('+∞', lineEnd + 34, axisY);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'italic 700 20px "Inter", Georgia, serif';
  ctx.fillText(nl.axisLabel, lineEnd + 36, axisY - 26);

  // Regular tick marks
  ctx.font = '600 15px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const criticalXs: number[] = [];
  for (const iv of nl.intervals) {
    if (iv.from !== null) criticalXs.push(clampX(mapX(iv.from)));
    if (iv.to !== null) criticalXs.push(clampX(mapX(iv.to)));
  }
  for (const pt of nl.points) criticalXs.push(clampX(mapX(pt.value)));

  for (const tick of nl.ticks) {
    const px = mapX(tick);
    if (px < lineStart + 6 || px > lineEnd - 6) continue;
    const isZero = Math.abs(tick) < 1e-9;
    ctx.strokeStyle = isZero ? '#e2e8f0' : 'rgba(147, 197, 253, 0.55)';
    ctx.lineWidth = isZero ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(px, axisY - (isZero ? 11 : 7));
    ctx.lineTo(px, axisY + (isZero ? 11 : 7));
    ctx.stroke();

    // Avoid colliding regular tick text with critical endpoint labels
    const tooClose = criticalXs.some((cx) => Math.abs(cx - px) < 34);
    if (!tooClose) {
      ctx.fillStyle = isZero ? '#f8fafc' : '#94a3b8';
      ctx.fillText(formatTick(tick), px, axisY + 34);
    }
  }

  // Highlight solution intervals with glowing bands + endpoints
  const showBrackets = nl.notation === 'bracket' || nl.notation === 'both';
  const showCircles = nl.notation === 'circle' || nl.notation === 'both';

  solutionIntervals.forEach((iv) => {
    const x1 = iv.from === null ? lineStart - 10 : clampX(mapX(iv.from));
    const x2 = iv.to === null ? lineEnd + 16 : clampX(mapX(iv.to));

    // Glowing translucent band over interval
    ctx.fillStyle = withAlpha(iv.color, 0.2);
    ctx.fillRect(x1, axisY - 14, Math.max(4, x2 - x1), 28);

    // Bright glowing solution segment on axis
    ctx.save();
    ctx.strokeStyle = iv.color;
    ctx.lineWidth = 7;
    ctx.shadowColor = withAlpha(iv.color, 0.85);
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(x1, axisY);
    ctx.lineTo(x2, axisY);
    ctx.stroke();
    ctx.restore();

    // Unbounded ray arrowheads
    if (iv.from === null) {
      ctx.fillStyle = iv.color;
      ctx.beginPath();
      ctx.moveTo(lineStart - 18, axisY);
      ctx.lineTo(lineStart - 4, axisY - 8);
      ctx.lineTo(lineStart - 4, axisY + 8);
      ctx.closePath();
      ctx.fill();
    }
    if (iv.to === null) {
      ctx.fillStyle = iv.color;
      ctx.beginPath();
      ctx.moveTo(lineEnd + 24, axisY);
      ctx.lineTo(lineEnd + 10, axisY - 8);
      ctx.lineTo(lineEnd + 10, axisY + 8);
      ctx.closePath();
      ctx.fill();
    }

    // Endpoints (brackets + circles + crisp value labels)
    const drawEnd = (val: number, side: 'left' | 'right', inc: boolean) => {
      const px = clampX(mapX(val));
      if (showBrackets) {
        drawBracketGlyph(ctx, px, axisY, side, inc, iv.color);
      }
      if (showCircles) {
        ctx.beginPath();
        ctx.arc(px, axisY, 8.5, 0, Math.PI * 2);
        ctx.fillStyle = inc ? iv.color : '#020817';
        ctx.fill();
        ctx.strokeStyle = iv.color;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 18px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(formatTick(val), px, axisY + 34);
    };

    if (iv.from !== null) drawEnd(iv.from, 'left', iv.includeFrom);
    if (iv.to !== null) drawEnd(iv.to, 'right', iv.includeTo);

    if (iv.label) {
      const midX = (x1 + x2) / 2;
      ctx.fillStyle = iv.color;
      ctx.font = '700 16px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(iv.label, midX, axisY - 34);
    }
  });

  // Discrete points on the number line
  for (const pt of nl.points) {
    const px = clampX(mapX(pt.value));
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, axisY, 9, 0, Math.PI * 2);
    ctx.fillStyle = pt.filled ? pt.color : '#020817';
    ctx.shadowColor = withAlpha(pt.color, 0.8);
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.strokeStyle = pt.color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 17px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(formatTick(pt.value), px, axisY + 34);

    if (pt.label) {
      ctx.fillStyle = pt.color;
      ctx.font = '700 15px "Inter", system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText(pt.label, px, axisY - 22);
    }
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

  if (hasRightAxis && rightBounds) {
    for (const tick of rightBounds.ticks) {
      const py = mapYRight(tick);
      ctx.fillStyle = rightSeries[0]?.color ?? '#34d399';
      ctx.textAlign = 'left';
      ctx.fillText(formatTick(tick), padL + plotW + 12, py);
    }
  }

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

  if (spec.chartType === 'number_line') {
    renderNumberLineChart(ctx, width, height, contentTop, spec);
  } else if (spec.chartType === 'pie' || spec.chartType === 'donut') {
    renderPieOrDonut(ctx, width, height, contentTop, spec);
  } else {
    renderCartesianChart(ctx, width, height, contentTop, spec);
  }
}
