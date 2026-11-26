/**
 * Pure Matrix character-decode text reveal & expression heuristic fallback.
 */
import type { TheonExpression, TheonMatrixSpeed } from './theonConfig';

const MATRIX_GLYPHS = '01アイウエオカキクケコ∑∆ΩλΦΨ#%*+=-:<>[]';

export const MATRIX_SPEED_MS_PER_CHAR: Record<TheonMatrixSpeed, number> = Object.freeze({
  fast: 14,
  medium: 26,
  slow: 42,
});

/**
 * Produces one animation frame of `target` being revealed from left to right
 * through a rolling band of Matrix glyphs. Whitespace and newlines are preserved
 * so layout never jumps during decoding.
 */
export function renderMatrixFrame(target: string, progress: number, frameSeed = 0): string {
  if (!target) return '';
  const clamped = Math.max(0, Math.min(1, progress));
  if (clamped >= 1) return target;

  const chars = Array.from(target);
  const total = chars.length;
  const revealed = Math.floor(clamped * total);
  const scrambleBand = Math.min(18, Math.max(4, Math.ceil(total * 0.14)));
  const frontier = Math.min(total, revealed + scrambleBand);

  const out: string[] = new Array(frontier);
  for (let i = 0; i < frontier; i++) {
    const ch = chars[i] ?? '';
    if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') {
      out[i] = ch;
    } else if (i < revealed) {
      out[i] = ch;
    } else {
      const idx = Math.abs((i * 31 + frameSeed * 17) % MATRIX_GLYPHS.length);
      out[i] = MATRIX_GLYPHS[idx] ?? '0';
    }
  }
  return out.join('');
}

export interface MatrixRevealOptions {
  speed?: TheonMatrixSpeed;
  onFrame: (text: string) => void;
  onDone?: () => void;
}

/**
 * Drives a requestAnimationFrame Matrix text reveal and returns a cancel handle.
 */
export function startMatrixReveal(target: string, options: MatrixRevealOptions): () => void {
  const { speed = 'fast', onFrame, onDone } = options;
  const chars = Array.from(target);
  if (!chars.length) {
    onFrame('');
    onDone?.();
    return () => {};
  }

  const msPerChar = MATRIX_SPEED_MS_PER_CHAR[speed] ?? MATRIX_SPEED_MS_PER_CHAR.fast;
  // Cap total reveal duration so long replies stay crisp and readable.
  const durationMs = Math.max(360, Math.min(2800, chars.length * msPerChar));

  let cancelled = false;
  let rafId = 0;
  let frameSeed = 0;
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const tick = () => {
    if (cancelled) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const progress = Math.min(1, (now - startTime) / durationMs);
    frameSeed++;
    onFrame(renderMatrixFrame(target, progress, frameSeed));
    if (progress >= 1) {
      onDone?.();
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
  };
}

/**
 * Heuristic fallback expression classifier used when an AI provider does not
 * return an explicit `set_expression` tool call.
 */
export function detectExpressionFromText(text: string): TheonExpression {
  const s = (text || '').toLowerCase();
  if (!s.trim()) return 'friendly';
  if (/(cảnh báo|nghiêm trọng|nguy hiểm|lỗi|không thể|sai|chú ý|quan trọng|bắt buộc)/.test(s)) {
    return 'serious';
  }
  if (/(ồ|wow|thật bất ngờ|ngạc nhiên|đột phá|khám phá|kỳ diệu)/.test(s) || /!!/.test(s)) {
    return 'surprised';
  }
  if (/(chính xác|tuyệt vời|xuất sắc|chúc mừng|rất tốt|hoàn hảo|vui)/.test(s)) {
    return 'happy';
  }
  if (/\?/.test(s) || /(tại sao|vì sao|giả sử|suy nghĩ|cân nhắc|có lẽ|liệu)/.test(s)) {
    return 'thoughtful';
  }
  if (/(thuật toán|phương trình|công thức|chuẩn độ|mol|pH|Ka|pKa|hàm|matrix|code|vector|bước 1)/i.test(s)) {
    return 'focused';
  }
  if (/(thư giãn|nhẹ nhàng|từ từ|nghỉ ngơi|thoải mái|bình tĩnh)/.test(s)) {
    return 'relaxed';
  }
  return 'friendly';
}
