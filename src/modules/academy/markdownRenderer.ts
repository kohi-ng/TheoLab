/**
 * Safe DOM-only Markdown + KaTeX renderer for `format: "markdown"` tabs.
 * Untrusted text is always inserted via `textContent`; KaTeX renders only math spans.
 */
import katex from 'katex';
import 'katex/contrib/mhchem';

function appendInline(parent: HTMLElement, text: string): void {
  // Matches: $math$, `code`, **bold**, *italic*
  const pattern = /(\$[^$\n]+?\$|`[^`\n]+?`|\*\*[^*\n]+?\*\*|\*[^*\n]+?\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const token = match[0];
    if (token.startsWith('$') && token.endsWith('$')) {
      const span = document.createElement('span');
      try {
        katex.render(token.slice(1, -1), span, { throwOnError: false, displayMode: false });
      } catch {
        span.textContent = token;
      }
      parent.append(span);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      const code = document.createElement('code');
      code.className = 'md-inline-code';
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (token.startsWith('**') && token.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      const em = document.createElement('em');
      em.textContent = token.slice(1, -1);
      parent.append(em);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    parent.append(document.createTextNode(text.slice(lastIndex)));
  }
}

export function renderSafeMarkdown(container: HTMLElement, markdown: string): void {
  container.replaceChildren();
  const lines = markdown.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Display math block $$ ... $$
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
      const mathEl = document.createElement('div');
      mathEl.className = 'md-math-block';
      try {
        katex.render(mathLines.join('\n').trim(), mathEl, { throwOnError: false, displayMode: true });
      } catch {
        mathEl.textContent = mathLines.join('\n');
      }
      container.append(mathEl);
      continue;
    }

    // Fenced code block ```
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      const pre = document.createElement('pre');
      pre.className = 'md-code-block';
      const code = document.createElement('code');
      code.textContent = codeLines.join('\n');
      pre.append(code);
      container.append(pre);
      continue;
    }

    // Headings # .. ####
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(4, (headingMatch[1] ?? '#').length + 1);
      const h = document.createElement(`h${level}`);
      h.className = `md-h${level}`;
      appendInline(h, headingMatch[2] ?? '');
      container.append(h);
      i += 1;
      continue;
    }

    // Blockquote >
    if (trimmed.startsWith('>')) {
      const quote = document.createElement('blockquote');
      quote.className = 'md-quote';
      const parts: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        parts.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i += 1;
      }
      appendInline(quote, parts.join(' '));
      container.append(quote);
      continue;
    }

    // Unordered list - or *
    if (/^[-*]\s+/.test(trimmed)) {
      const ul = document.createElement('ul');
      ul.className = 'md-list';
      while (i < lines.length && /^[-*]\s+/.test((lines[i] ?? '').trim())) {
        const li = document.createElement('li');
        appendInline(li, (lines[i] ?? '').trim().replace(/^[-*]\s+/, ''));
        ul.append(li);
        i += 1;
      }
      container.append(ul);
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length
      && (lines[i] ?? '').trim() !== ''
      && !/^(#{1,4}\s+|[-*]\s+|>|```|\$\$)/.test((lines[i] ?? '').trim())
    ) {
      paraLines.push((lines[i] ?? '').trim());
      i += 1;
    }
    const p = document.createElement('p');
    p.className = 'md-paragraph';
    appendInline(p, paraLines.join(' '));
    container.append(p);
  }
}
