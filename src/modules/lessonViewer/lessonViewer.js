import katex from 'katex';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';
import { checkChoice, checkNumeric } from '../assessmentEngine/assessmentEngine.js';
import { getActiveContext, updateContext } from '../../core/contextBus.js';
import { mountWidget, unmountWidgets } from '../../core/moduleRegistry.js';

const embeddedFrames = new WeakMap();
const renderQueues = new WeakMap();
const renderVersions = new WeakMap();

function clearEmbeddedFrames(root) {
  root.querySelectorAll('iframe.widget-frame').forEach((iframe) => {
    embeddedFrames.get(iframe)?.();
    embeddedFrames.delete(iframe);
  });
}

export async function disposeLessonResources(root) {
  let unmountFailure;
  try {
    await unmountWidgets(root);
  } catch (error) {
    unmountFailure = error;
  }
  clearEmbeddedFrames(root);
  if (unmountFailure) throw unmountFailure;
}

function renderMath(root) {
  root.querySelectorAll('[data-math]').forEach((node) => {
    try {
      katex.render(node.dataset.math, node, { throwOnError: false, displayMode: true });
    } catch (error) {
      node.textContent = node.dataset.math;
    }
  });
}

export function toGooglePreviewUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['drive.google.com', 'docs.google.com'].includes(parsed.hostname)) return url;
    const fileId = parsed.pathname.match(/\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d)\/([^/]+)/)?.[1]
      ?? parsed.searchParams.get('id');
    return fileId ? `https://drive.google.com/file/d/${fileId}/preview` : url;
  } catch {
    return url;
  }
}

function currentTheme() {
  const styles = getComputedStyle(document.documentElement);
  return ['--bg-canvas', '--surface-card', '--surface-elevated', '--surface-hover', '--text-primary', '--text-secondary', '--accent-solid']
    .reduce((theme, token) => {
      theme[token] = styles.getPropertyValue(token).trim();
      return theme;
    }, {});
}

export function renderEmbeddedWidget(block, section) {
  const iframe = document.createElement('iframe');
  iframe.className = 'widget-frame';
  iframe.title = block.title ?? 'TheoLab interactive widget';
  iframe.loading = 'lazy';
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.height = `${Math.max(240, Math.min(Number(block.height) || 420, 1200))}px`;
  const filename = String(block.file ?? '');
  if (!/^[\w.-]+\.html$/i.test(filename)) {
    const error = document.createElement('p');
    error.className = 'status-line';
    error.textContent = 'Tệp widget phải là một tên tệp HTML hợp lệ trong public/widgets/.';
    section.append(error);
    return;
  }
  iframe.src = `${import.meta.env.BASE_URL}widgets/${encodeURIComponent(filename)}`;
  const onLoad = () => {
    iframe.contentWindow?.postMessage({
      type: 'THEOLAB_INIT',
      // Blocks can be Svelte $state proxies, which postMessage cannot clone.
      payload: { state: JSON.parse(JSON.stringify(block.initial_state ?? {})), theme: currentTheme() },
    }, '*');
  };
  const onMessage = (event) => {
    if (event.source !== iframe.contentWindow || event.data?.type !== 'THEOLAB_WIDGET_STATE') return;
    let payload;
    try {
      const serialized = JSON.stringify(event.data.payload);
      if (serialized.length > 16384) return;
      payload = JSON.parse(serialized);
    } catch {
      return;
    }
    updateContext({
      selectedBlockId: block.id,
      widgetState: { widgetId: block.id, payload },
    });
  };
  iframe.addEventListener('load', onLoad);
  window.addEventListener('message', onMessage);
  embeddedFrames.set(iframe, () => {
    iframe.removeEventListener('load', onLoad);
    window.removeEventListener('message', onMessage);
    if (getActiveContext().widgetState?.widgetId === block.id) {
      updateContext({ widgetState: null });
    }
  });
  section.append(iframe);
}

async function renderLessonNow(lesson, container, isCurrent) {
  await disposeLessonResources(container);
  if (!isCurrent()) return;
  container.replaceChildren();
  const title = document.createElement('h1');
  title.className = 'lesson-title';
  title.textContent = lesson.payload.title;
  container.append(title);

  const intro = document.createElement('p');
  intro.className = 'lesson-intro';
  intro.textContent = 'Học theo từng khối, thử bài tập và lưu tiến độ của bạn.';
  container.append(intro);

  for (const [index, block] of lesson.payload.blocks.entries()) {
    const section = document.createElement('section');
    section.className = `lesson-block block-${block.type}`;
    section.dataset.blockId = block.id ?? `block-${index}`;
    const heading = document.createElement('h2');
    heading.textContent = block.title ?? '';
    if (block.title) section.append(heading);

    if (block.type === 'theory') {
      const body = document.createElement('p');
      body.textContent = block.content;
      section.append(body);
      if (block.formula) {
        const formula = document.createElement('div');
        formula.className = 'formula-display';
        formula.dataset.math = block.formula;
        section.append(formula);
      }
    } else if (block.type === 'callout') {
      const body = document.createElement('p');
      body.textContent = block.content;
      section.append(body);
    } else if (block.type === 'collapsible') {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = block.summary;
      const body = document.createElement('p');
      body.textContent = block.content;
      details.append(summary, body);
      section.append(details);
    } else if (block.type === 'google_embed') {
      const frame = document.createElement('iframe');
      frame.src = toGooglePreviewUrl(block.url);
      frame.title = block.title ?? 'Tài liệu nhúng';
      frame.loading = 'lazy';
      frame.referrerPolicy = 'no-referrer';
      frame.allow = 'autoplay';
      section.append(frame);
    } else if (block.type === 'widget_embed') {
      renderEmbeddedWidget(block, section);
    } else if (block.type === 'widget_native') {
      const mountPoint = document.createElement('div');
      mountPoint.className = 'native-widget';
      section.append(mountPoint);
      try {
        await mountWidget(block.widget_id, mountPoint, { ...block.props, blockId: block.id }, {
          contextBus: { getActiveContext, updateContext },
          owner: container,
        });
        if (!isCurrent()) {
          await unmountWidgets(container);
          clearEmbeddedFrames(section);
          return;
        }
      } catch (error) {
        if (!isCurrent()) return;
        mountPoint.textContent = `Không thể tải widget: ${error.message}`;
      }
    } else if (block.type === 'mcq') {
      block.options.forEach((option, optionIndex) => {
        const label = document.createElement('label');
        label.className = 'choice-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = block.id;
        input.value = String(optionIndex);
        const text = document.createElement('span');
        text.textContent = option.text;
        label.append(input, text);
        section.append(label);
      });
      const submit = document.createElement('button');
      submit.className = 'button button-soft';
      submit.textContent = 'Kiểm tra đáp án';
      const feedback = document.createElement('p');
      feedback.className = 'exercise-feedback';
      submit.addEventListener('click', () => {
        const selected = section.querySelector(`input[name="${CSS.escape(block.id)}"]:checked`);
        if (!selected) {
          feedback.textContent = 'Hãy chọn một đáp án.';
          return;
        }
        const result = checkChoice(block, Number(selected.value));
        feedback.textContent = result.feedback;
        feedback.dataset.state = result.correct ? 'correct' : 'incorrect';
        updateContext({ selectedBlockId: block.id, lastExerciseResult: result });
      });
      section.append(submit, feedback);
    } else if (block.type === 'numeric') {
      const input = document.createElement('input');
      input.className = 'numeric-input';
      input.type = 'number';
      input.step = 'any';
      input.placeholder = block.placeholder ?? 'Nhập đáp số';
      const submit = document.createElement('button');
      submit.className = 'button button-soft';
      submit.textContent = 'Kiểm tra';
      const feedback = document.createElement('p');
      feedback.className = 'exercise-feedback';
      submit.addEventListener('click', () => {
        const result = checkNumeric({ value: input.value, answer: block.answer, tolerance: block.tolerance });
        feedback.textContent = result.feedback;
        feedback.dataset.state = result.correct ? 'correct' : 'incorrect';
        updateContext({ selectedBlockId: block.id, lastExerciseResult: result });
      });
      section.append(input, submit, feedback);
    } else {
      section.className = 'lesson-block block-unknown';
      const body = document.createElement('p');
      body.textContent = `Khối "${block.type}" chưa được hỗ trợ.`;
      section.append(body);
    }
    if (!isCurrent()) {
      clearEmbeddedFrames(section);
      return;
    }
    section.addEventListener('click', () => updateContext({ selectedBlockId: block.id ?? `block-${index}` }));
    container.append(section);
  }
  if (!isCurrent()) return;
  renderMath(container);
  updateContext({ lessonId: lesson.id, lessonTitle: lesson.payload.title });
}

export function renderLesson(lesson, container) {
  const revision = (renderVersions.get(container) ?? 0) + 1;
  renderVersions.set(container, revision);
  const isCurrent = () => renderVersions.get(container) === revision;
  const previous = renderQueues.get(container) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => {
    if (!isCurrent()) return;
    return renderLessonNow(lesson, container, isCurrent);
  });
  renderQueues.set(container, next);
  return next;
}
