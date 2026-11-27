/**
 * Safe DOM-only Markdown + KaTeX/mhchem formatter for Theon AI replies,
 * plus natural Vietnamese speech cleaner for AI TTS.
 *
 * Security: Never sets innerHTML on untrusted text. All prose goes through
 * textContent/createTextNode, and KaTeX runs with `trust: false`.
 */
import katex from 'katex';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';

export interface RenderTheonReplyOptions {
  onDeepLink?: (deepLink: string) => void;
}

/**
 * Normalize AI output so standard LaTeX delimiters (`\[...\]`, `\(...\)`)
 * become canonical `$$...$$` and `$...$` while leaving fenced code blocks intact.
 */
export function normalizeAiMarkdown(raw: string): string {
  const input = String(raw ?? '').replace(/\r\n?/g, '\n');
  if (!input.trim()) return '';

  // Split by fenced code blocks so we never alter code contents.
  const segments = input.split(/(```[\s\S]*?```)/g);
  const normalized = segments.map((seg) => {
    if (seg.startsWith('```')) return seg;

    // 1) Block math \[ ... \] -> \n$$\n...\n$$\n
    let out = seg.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner: string) => {
      const trimmed = inner.trim();
      if (!trimmed) return '';
      return `\n$$\n${trimmed}\n$$\n`;
    });

    // 2) Inline math \( ... \) -> $...$
    out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner: string) => {
      const trimmed = inner.trim();
      if (!trimmed) return '';
      return `$${trimmed}$`;
    });

    // 3) Mid-line $$...$$ -> own block so block renderer picks it up cleanly
    out = out.replace(/([^\n])\$\$([^\n$]+?)\$\$/g, '$1\n$$\n$2\n$$\n');
    out = out.replace(/\$\$([^\n$]+?)\$\$([^\n])/g, '\n$$\n$1\n$$\n$2');

    // 4) Collapse excessive blank lines
    out = out.replace(/\n{3,}/g, '\n\n');
    return out;
  });

  return normalized.join('').trim();
}

function renderInlineMath(parent: HTMLElement, tex: string, fallback: string): void {
  const span = document.createElement('span');
  span.className = 'theon-math-inline';
  try {
    katex.render(tex.trim(), span, {
      throwOnError: false,
      displayMode: false,
      trust: false,
      strict: false,
    });
  } catch {
    span.textContent = fallback;
  }
  parent.append(span);
}

function renderDisplayMath(parent: HTMLElement, tex: string): void {
  const div = document.createElement('div');
  div.className = 'theon-math-block';
  try {
    katex.render(tex.trim(), div, {
      throwOnError: false,
      displayMode: true,
      trust: false,
      strict: false,
    });
  } catch {
    div.textContent = tex;
  }
  parent.append(div);
}

function isSafeHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function appendInline(
  parent: HTMLElement,
  text: string,
  options?: RenderTheonReplyOptions,
  depth = 0,
): void {
  if (!text) return;
  if (depth > 3) {
    parent.append(document.createTextNode(text));
    return;
  }

  // Token order: inline code, markdown link, inline math ($...$), bold (**...**), italic (*...*), bare deep link
  const pattern =
    /(`[^`\n]+?`|\[([^\]\n]+?)\]\(([^)\s]+?)\)|(?<!\\)\$(?!\s)(?:\\.|[^$\n])+?(?<!\s)\$|\*\*[^*\n]+?\*\*|\*(?!\s)[^*\n]+?(?<!\s)\*|#\/[a-z0-9/_#-]+)/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, match.index).replace(/\\\$/g, '$')));
    }

    const token = match[0];

    if (token.startsWith('`') && token.endsWith('`')) {
      const code = document.createElement('code');
      code.className = 'theon-inline-code';
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (token.startsWith('[') && match[2] && match[3]) {
      const label = match[2];
      const href = match[3];
      if (href.startsWith('#/')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theon-deep-link';
        btn.textContent = label;
        btn.addEventListener('click', () => options?.onDeepLink?.(href));
        parent.append(btn);
      } else if (isSafeHttpsUrl(href)) {
        const a = document.createElement('a');
        a.className = 'theon-ext-link';
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = label;
        parent.append(a);
      } else {
        parent.append(document.createTextNode(label));
      }
    } else if (token.startsWith('$') && token.endsWith('$') && token.length > 2) {
      const inner = token.slice(1, -1);
      // Avoid mis-parsing plain currency like "$5 ... $10" if inner starts with digits and has spaces of prose
      const looksLikeCurrency = /^\d+(?:[.,]\d+)?\s+[a-zA-ZÀ-ỹ]/.test(inner);
      if (looksLikeCurrency) {
        parent.append(document.createTextNode(token));
      } else {
        renderInlineMath(parent, inner, token);
      }
    } else if (token.startsWith('**') && token.endsWith('**')) {
      const strong = document.createElement('strong');
      appendInline(strong, token.slice(2, -2), options, depth + 1);
      parent.append(strong);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      const em = document.createElement('em');
      appendInline(em, token.slice(1, -1), options, depth + 1);
      parent.append(em);
    } else if (token.startsWith('#/')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theon-deep-link';
      btn.textContent = token;
      btn.addEventListener('click', () => options?.onDeepLink?.(token));
      parent.append(btn);
    } else {
      parent.append(document.createTextNode(token));
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parent.append(document.createTextNode(text.slice(lastIndex).replace(/\\\$/g, '$')));
  }
}

function parseTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') && !trimmed.includes('-')) return false;
  return /^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/.test(trimmed);
}

/**
 * Render formatted Markdown + KaTeX + mhchem safely into a container element.
 */
export function renderTheonReply(
  container: HTMLElement,
  rawText: string,
  options?: RenderTheonReplyOptions,
): void {
  container.replaceChildren();
  const normalized = normalizeAiMarkdown(rawText);
  if (!normalized) return;

  const lines = normalized.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1) Display math block $$ ... $$
    if (trimmed.startsWith('$$')) {
      const mathLines: string[] = [];
      if (trimmed.length > 2 && trimmed.endsWith('$$')) {
        mathLines.push(trimmed.slice(2, -2));
        i += 1;
      } else {
        if (trimmed.length > 2) mathLines.push(trimmed.slice(2));
        i += 1;
        while (i < lines.length && !(lines[i] ?? '').trim().endsWith('$$')) {
          mathLines.push(lines[i] ?? '');
          i += 1;
        }
        if (i < lines.length) {
          const closing = (lines[i] ?? '').trim();
          if (closing.length > 2) mathLines.push(closing.slice(0, -2));
          i += 1;
        }
      }
      renderDisplayMath(container, mathLines.join('\n'));
      continue;
    }

    // 2) Fenced code block ```
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      const pre = document.createElement('pre');
      pre.className = 'theon-code-block';
      const code = document.createElement('code');
      code.textContent = codeLines.join('\n');
      pre.append(code);
      container.append(pre);
      continue;
    }

    // 3) Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      const hr = document.createElement('hr');
      hr.className = 'theon-hr';
      container.append(hr);
      i += 1;
      continue;
    }

    // 4) Headings
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(4, (headingMatch[1] ?? '#').length + 1);
      const h = document.createElement(`h${level}`);
      h.className = `theon-md-h${level}`;
      appendInline(h, headingMatch[2] ?? '', options);
      container.append(h);
      i += 1;
      continue;
    }

    // 5) Markdown table
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1] ?? '')) {
      const headerCells = parseTableCells(trimmed);
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length) {
        const rowLine = (lines[i] ?? '').trim();
        if (!rowLine || !rowLine.includes('|')) break;
        bodyRows.push(parseTableCells(rowLine));
        i += 1;
      }
      const wrap = document.createElement('div');
      wrap.className = 'theon-table-wrap';
      const table = document.createElement('table');
      table.className = 'theon-md-table';
      const thead = document.createElement('thead');
      const headTr = document.createElement('tr');
      for (const cell of headerCells) {
        const th = document.createElement('th');
        appendInline(th, cell, options);
        headTr.append(th);
      }
      thead.append(headTr);
      table.append(thead);

      if (bodyRows.length > 0) {
        const tbody = document.createElement('tbody');
        for (const row of bodyRows) {
          const tr = document.createElement('tr');
          for (let c = 0; c < headerCells.length; c++) {
            const td = document.createElement('td');
            appendInline(td, row[c] ?? '', options);
            tr.append(td);
          }
          tbody.append(tr);
        }
        table.append(tbody);
      }
      wrap.append(table);
      container.append(wrap);
      continue;
    }

    // 6) Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i += 1;
      }
      const bq = document.createElement('blockquote');
      bq.className = 'theon-md-quote';
      appendInline(bq, quoteLines.join(' '), options);
      container.append(bq);
      continue;
    }

    // 7) Unordered list
    if (/^[-*•]\s+/.test(trimmed)) {
      const ul = document.createElement('ul');
      ul.className = 'theon-md-list';
      while (i < lines.length && /^[-*•]\s+/.test((lines[i] ?? '').trim())) {
        const li = document.createElement('li');
        appendInline(li, (lines[i] ?? '').trim().replace(/^[-*•]\s+/, ''), options);
        ul.append(li);
        i += 1;
      }
      container.append(ul);
      continue;
    }

    // 8) Ordered list
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const ol = document.createElement('ol');
      ol.className = 'theon-md-list';
      while (i < lines.length && /^\d+[.)]\s+/.test((lines[i] ?? '').trim())) {
        const li = document.createElement('li');
        appendInline(li, (lines[i] ?? '').trim().replace(/^\d+[.)]\s+/, ''), options);
        ol.append(li);
        i += 1;
      }
      container.append(ol);
      continue;
    }

    // 9) Paragraph (coalesce consecutive plain lines)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = (lines[i] ?? '').trim();
      if (
        !cur ||
        cur.startsWith('$$') ||
        cur.startsWith('```') ||
        cur.startsWith('>') ||
        /^(#{1,4})\s+/.test(cur) ||
        /^[-*•]\s+/.test(cur) ||
        /^\d+[.)]\s+/.test(cur) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(cur) ||
        (cur.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1] ?? ''))
      ) {
        break;
      }
      paraLines.push(cur);
      i += 1;
    }
    const p = document.createElement('p');
    p.className = 'theon-md-p';
    for (let idx = 0; idx < paraLines.length; idx++) {
      if (idx > 0) p.append(document.createElement('br'));
      appendInline(p, paraLines[idx] ?? '', options);
    }
    container.append(p);
  }
}

/**
 * Clean Markdown & LaTeX into natural spoken Vietnamese for TTS synthesis.
 */
export function stripFormattingForSpeech(raw: string): string {
  let text = normalizeAiMarkdown(raw);
  if (!text) return '';

  // Remove fenced code blocks
  text = text.replace(/```[\s\S]*?```/g, ' đoạn mã ');

  // Keep markdown link labels only
  text = text.replace(/\[([^\]\n]+?)\]\([^)\s]+?\)/g, '$1');

  // Remove raw deep links
  text = text.replace(/#\/[a-z0-9/_#-]+/gi, '');

  // Translate common LaTeX constructs inside math before stripping symbols
  const translateLatex = (expr: string): string => {
    let s = expr;
    // \ce{H2O} -> H2O
    s = s.replace(/\\ce\{([^{}]+)\}/g, '$1');
    // \text{...} / \mathrm{...}
    s = s.replace(/\\(?:text|mathrm|mathbf|mathit)\{([^{}]+)\}/g, '$1');
    // \frac{a}{b} -> a phần b (up to 2 passes for simple nesting)
    for (let p = 0; p < 2; p++) {
      s = s.replace(/\\d?frac\{([^{}]+)\}\{([^{}]+)\}/g, ' $1 phần $2 ');
    }
    // \sqrt[n]{x} and \sqrt{x}
    s = s.replace(/\\sqrt\[([^{}\]]+)\]\{([^{}]+)\}/g, ' căn bậc $1 của $2 ');
    s = s.replace(/\\sqrt\{([^{}]+)\}/g, ' căn bậc hai của $1 ');
    // Common powers
    s = s.replace(/\^2\b|\^\{2\}/g, ' bình phương');
    s = s.replace(/\^3\b|\^\{3\}/g, ' lập phương');
    s = s.replace(/\^\{([^{}]+)\}/g, ' mũ $1');
    s = s.replace(/\^([a-zA-Z0-9])/g, ' mũ $1');
    // Relations & operators
    const replacements: Array<[RegExp, string]> = [
      [/\\leq?|\\leqslant/g, ' nhỏ hơn hoặc bằng '],
      [/\\geq?|\\geqslant/g, ' lớn hơn hoặc bằng '],
      [/\\neq?/g, ' khác '],
      [/\\approx/g, ' xấp xỉ '],
      [/\\pm/g, ' cộng trừ '],
      [/\\times|\\cdot/g, ' nhân '],
      [/\\div/g, ' chia '],
      [/\\infty/g, ' vô cực '],
      [/\\cup/g, ' hợp '],
      [/\\cap/g, ' giao '],
      [/\\notin/g, ' không thuộc '],
      [/\\in\b/g, ' thuộc '],
      [/\\Rightarrow|\\implies/g, ' suy ra '],
      [/\\Leftrightarrow|\\iff/g, ' tương đương '],
      [/\\rightarrow|\\to\b/g, ' tiến tới '],
      [/\\pi\b/g, ' pi '],
      [/\\Delta\b/g, ' delta '],
      [/\\alpha\b/g, ' alpha '],
      [/\\beta\b/g, ' beta '],
      [/\\gamma\b/g, ' gamma '],
      [/\\theta\b/g, ' theta '],
      [/\\lambda\b/g, ' lambda '],
      [/\\omega\b/g, ' omega '],
      [/\\mathbb\{R\}/g, ' tập số thực R '],
      [/\\left|\\right/g, ' '],
    ];
    for (const [rx, rep] of replacements) {
      s = s.replace(rx, rep);
    }
    // Remove remaining LaTeX command names & braces
    s = s.replace(/\\[a-zA-Z]+/g, ' ');
    s = s.replace(/[{}]/g, ' ');
    return s;
  };

  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner: string) => ` ${translateLatex(inner)} `);
  text = text.replace(/\$([^$\n]+?)\$/g, (_m, inner: string) => ` ${translateLatex(inner)} `);

  // Translate Unicode math symbols too
  text = text
    .replace(/−∞|-∞/g, ' âm vô cực ')
    .replace(/\+∞/g, ' dương vô cực ')
    .replace(/∞/g, ' vô cực ')
    .replace(/≤/g, ' nhỏ hơn hoặc bằng ')
    .replace(/≥/g, ' lớn hơn hoặc bằng ')
    .replace(/≠/g, ' khác ')
    .replace(/≈/g, ' xấp xỉ ')
    .replace(/∪/g, ' hợp ')
    .replace(/∩/g, ' giao ')
    .replace(/∈/g, ' thuộc ')
    .replace(/∉/g, ' không thuộc ')
    .replace(/⇒|→/g, ' suy ra ')
    .replace(/⇔/g, ' tương đương ');

  // Remove Markdown punctuation
  text = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*•]\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\|/g, ', ')
    .replace(/[-_]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}
