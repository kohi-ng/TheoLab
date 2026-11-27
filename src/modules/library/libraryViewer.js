import katex from 'katex';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';
import { renderEmbeddedWidget } from '../lessonViewer/lessonViewer.js';

function appendMathText(parent, text) {
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$(?!\$)[^$\n]+\$)/g);
  for (const part of parts) {
    if (!part) continue;
    const isDisplay = part.startsWith('$$') && part.endsWith('$$');
    const isInline = !isDisplay && part.startsWith('$') && part.endsWith('$');
    if (!isDisplay && !isInline) {
      parent.append(document.createTextNode(part));
      continue;
    }
    const math = document.createElement(isDisplay ? 'div' : 'span');
    math.className = isDisplay ? 'formula-display' : 'inline-math';
    try {
      katex.render(part.slice(isDisplay ? 2 : 1, isDisplay ? -2 : -1), math, {
        throwOnError: false,
        displayMode: isDisplay,
        trust: false,
      });
    } catch {
      math.textContent = part;
    }
    parent.append(math);
  }
}

function renderMarkdown(container, markdown) {
  const lines = markdown.split(/\r?\n/);
  let list = null;
  let displayMath = null;
  const appendDisplayMath = (expression) => {
    const node = document.createElement('div');
    node.className = 'formula-display';
    try {
      katex.render(expression, node, { throwOnError: false, displayMode: true, trust: false });
    } catch {
      node.textContent = expression;
    }
    container.append(node);
  };
  for (const line of lines) {
    if (displayMath !== null) {
      if (line.trim() === '$$') {
        appendDisplayMath(displayMath);
        displayMath = null;
      } else {
        displayMath += `${displayMath ? '\n' : ''}${line}`;
      }
      continue;
    }
    if (line.trim() === '$$') {
      displayMath = '';
      list = null;
      continue;
    }
    if (!line.trim()) {
      list = null;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      list = null;
      const element = document.createElement(`h${Math.min(4, heading[1].length + 1)}`);
      appendMathText(element, heading[2]);
      container.append(element);
      continue;
    }
    if (line.startsWith('- ')) {
      if (!list) {
        list = document.createElement('ul');
        container.append(list);
      }
      const item = document.createElement('li');
      appendMathText(item, line.slice(2));
      list.append(item);
      continue;
    }
    list = null;
    const paragraph = document.createElement('p');
    appendMathText(paragraph, line);
    container.append(paragraph);
  }
  if (displayMath !== null) appendDisplayMath(displayMath);
}

function sanitizeLessonJson(lesson) {
  return {
    id: lesson.id,
    subject: lesson.core?.subject ?? '',
    title: lesson.payload?.title ?? '',
    blocks: (lesson.payload?.blocks ?? []).map((block) => ({
      id: block.id,
      type: block.type,
      title: block.title,
      content: block.content ?? block.prompt ?? block.question ?? block.summary ?? '',
      formula: block.formula,
      options: block.options?.map((option) => option.text),
    })),
  };
}

function publicAssetUrl(directory, filename) {
  const segments = String(filename ?? '').split('/');
  if (!segments.length || segments.some((segment) => !/^[\w.-]+$/.test(segment) || segment === '.' || segment === '..')) {
    throw new Error('Đường dẫn tài liệu không hợp lệ.');
  }
  return `${import.meta.env.BASE_URL}${directory}/${segments.map(encodeURIComponent).join('/')}`;
}

function googlePreviewUrl(rawUrl, embeddedEdit = false) {
  const url = new URL(rawUrl);
  if (!['drive.google.com', 'docs.google.com'].includes(url.hostname)) {
    throw new Error('Chỉ hỗ trợ nhúng tài liệu từ Google Drive và Google Docs.');
  }
  const id = url.pathname.match(/\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d)\/([^/]+)/)?.[1]
    ?? url.searchParams.get('id');
  if (!id || id.startsWith('REPLACE_')) return null;
  const service = url.pathname.match(/^\/(document|spreadsheets|presentation)\/d\//)?.[1];
  if (embeddedEdit && service === 'document') return `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit?embedded=true`;
  if (service) return `https://docs.google.com/${service}/d/${encodeURIComponent(id)}/preview`;
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
}

function resolveViewerType(item) {
  if (
    item.kind === 'google-doc'
    || item.kind === 'google-sheet'
    || item.kind === 'google-slide'
    || item.kind === 'drive-file'
    || (item.source === 'drive' && item.url)
  ) {
    return 'google';
  }
  return item.type ?? item.kind;
}

function isDriveFolderItem(item) {
  if (item.mimeType === 'application/vnd.google-apps.folder') return true;
  if (!item.url) return false;
  try {
    const parsed = new URL(item.url);
    return parsed.hostname === 'drive.google.com' && parsed.pathname.includes('/folders/');
  } catch {
    return false;
  }
}

function addToolbar(container, item, onAttach, onOpenInDock) {
  const viewerType = resolveViewerType(item);
  const toolbar = document.createElement('header');
  toolbar.className = 'document-toolbar';
  const titleGroup = document.createElement('div');
  titleGroup.className = 'document-title-group';
  const title = document.createElement('h1');
  title.textContent = item.title;
  const source = document.createElement('p');
  source.textContent = item.sourceLabel ?? item.kind ?? item.type ?? '';
  titleGroup.append(title, source);
  const actions = document.createElement('div');
  actions.className = 'document-actions';
  if (typeof onOpenInDock === 'function') {
    const openDock = document.createElement('button');
    openDock.type = 'button';
    openDock.className = 'button button-soft';
    openDock.textContent = '◫ Mở sang khung phải';
    openDock.addEventListener('click', () => onOpenInDock(item));
    actions.append(openDock);
  }
  if (viewerType === 'google' && item.url) {
    const open = document.createElement('a');
    open.className = 'button button-soft';
    open.href = item.url;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = 'Mở tab mới';
    actions.append(open);
  }
  const attach = document.createElement('button');
  attach.type = 'button';
  attach.className = 'button button-soft';
  attach.textContent = 'Đính kèm vào Chat AI';
  attach.addEventListener('click', () => onAttach({
    id: item.id,
    title: item.title,
    type: viewerType,
    sourceLabel: item.sourceLabel ?? item.kind ?? viewerType,
    content: item.contextText ?? '',
  }));
  actions.append(attach);
  toolbar.append(titleGroup, actions);
  container.append(toolbar);
}

export async function renderLibraryDocument(container, item, { onAttach, renderFormula, onOpenInDock }) {
  const viewerType = resolveViewerType(item);
  container.replaceChildren();
  addToolbar(container, item, onAttach, onOpenInDock);
  const body = document.createElement('section');
  body.className = 'document-content';
  container.append(body);

  if (viewerType === 'google') {
    const note = document.createElement('p');
    note.className = 'status-line';
    note.textContent = item.note ?? item.description ?? 'Tài liệu được liên kết từ Google Drive.';
    body.append(note);
    if (isDriveFolderItem(item)) {
      const folderLink = document.createElement('a');
      folderLink.className = 'library-link';
      folderLink.href = item.url;
      folderLink.target = '_blank';
      folderLink.rel = 'noopener noreferrer';
      folderLink.textContent = `📁 Mở thư mục "${item.title}" trong Google Drive ↗`;
      body.append(folderLink);
      return;
    }
    const previewUrl = googlePreviewUrl(item.url, Boolean(item.embeddedEdit));
    if (!previewUrl) return;
    const frame = document.createElement('iframe');
    frame.className = 'document-frame';
    frame.title = item.title;
    frame.loading = 'lazy';
    frame.referrerPolicy = 'no-referrer';
    frame.src = previewUrl;
    body.append(frame);
    return;
  }

  if (viewerType === 'pdf') {
    const frame = document.createElement('iframe');
    frame.className = 'document-frame';
    frame.title = item.title;
    frame.loading = 'lazy';
    frame.src = publicAssetUrl('docs', item.file);
    body.append(frame);
    return;
  }

  if (viewerType === 'markdown') {
    const markdown = item.content ?? await fetch(publicAssetUrl('docs', item.file)).then((response) => {
      if (!response.ok) throw new Error(`Không thể tải tài liệu (HTTP ${response.status}).`);
      return response.text();
    });
    item.contextText = markdown.slice(0, 16000);
    const article = document.createElement('article');
    article.className = 'markdown-document';
    renderMarkdown(article, markdown);
    body.append(article);
    return;
  }

  if (viewerType === 'json') {
    const json = typeof item.content === 'string' ? JSON.parse(item.content) : item.content;
    item.contextText = JSON.stringify(sanitizeLessonJson(json)).slice(0, 16000);
    const pre = document.createElement('pre');
    pre.className = 'json-document';
    pre.textContent = JSON.stringify(json, null, 2);
    body.append(pre);
    return;
  }

  if (viewerType === 'formula') {
    await renderFormula(body);
    item.contextText ||= 'Formula Hub: Ka, Kb, pKa, pKw và phương trình Henderson–Hasselbalch.';
    return;
  }

  if (viewerType === 'widget') {
    renderEmbeddedWidget(item.widget, body);
    item.contextText ||= `Mô phỏng tương tác: ${item.title}.`;
    return;
  }

  body.textContent = 'Định dạng tài liệu này chưa được hỗ trợ.';
}
